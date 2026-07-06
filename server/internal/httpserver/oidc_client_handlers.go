package httpserver

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"app/internal/auth"
	"app/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	oidcHTTPTimeout          = 10 * time.Second
	oidcLoginStateCookieName = "oidc_login_state"
	oidcLoginStateTTL        = 10 * time.Minute
)

type oidcTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
}

type oidcUserError struct {
	status  int
	code    string
	message string
}

func (err oidcUserError) Error() string {
	return err.message
}

// startOIDCLogin godoc
//
// @Summary 发起 OIDC 登录
// @Description 根据登录方式 Key 创建 OIDC 登录状态，并重定向到第三方授权地址。
// @Tags 客户端认证
// @Produce json
// @Param key path string true "OIDC 登录方式 Key"
// @Param redirect query string false "登录成功后的站内跳转路径"
// @Success 302
// @Failure 400 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/auth/oidc/{key}/start [get]
func (s *Server) startOIDCLogin(c echo.Context) error {
	provider, err := s.findEnabledOIDCProviderByKey(c.Param("key"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "OIDC 登录方式不存在")
	}
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	redirectPath, err := normalizeOIDCRedirectPath(c.QueryParam("redirect"))
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "登录跳转地址格式错误")
	}
	scopes, err := parseOIDCScopes(provider.Scopes)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	state, err := generateOIDCRandomValue(32)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	codeVerifier, err := generateOIDCRandomValue(32)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	now := time.Now().UTC()
	if err := s.cleanupOIDCLoginStates(now); err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	loginState := store.OIDCLoginState{
		StateHash:    auth.HashSessionToken(state),
		ProviderID:   provider.ID,
		CodeVerifier: codeVerifier,
		RedirectPath: redirectPath,
		ExpiresAt:    now.Add(oidcLoginStateTTL),
		IP:           c.RealIP(),
		UserAgent:    c.Request().UserAgent(),
	}
	if err := s.db.Create(&loginState).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	setOIDCLoginStateCookie(c, state, loginState.ExpiresAt)

	authorizeURL, err := url.Parse(provider.AuthorizeURL)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	query := authorizeURL.Query()
	query.Set("response_type", "code")
	query.Set("client_id", provider.ClientID)
	query.Set("redirect_uri", oidcCallbackURL(c, provider.Key))
	query.Set("scope", strings.Join(scopes, " "))
	query.Set("state", state)
	query.Set("code_challenge", oidcCodeChallenge(codeVerifier))
	query.Set("code_challenge_method", "S256")
	authorizeURL.RawQuery = query.Encode()

	return c.Redirect(http.StatusFound, authorizeURL.String())
}

// finishOIDCLogin godoc
//
// @Summary 完成 OIDC 登录
// @Description 处理第三方 OIDC 回调，创建或关联普通用户并写入用户登录 Session。
// @Tags 客户端认证
// @Produce json
// @Param key path string true "OIDC 登录方式 Key"
// @Param code query string true "OIDC 授权码"
// @Param state query string true "OIDC 登录状态"
// @Success 302
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/auth/oidc/{key}/callback [get]
func (s *Server) finishOIDCLogin(c echo.Context) error {
	defer clearOIDCLoginStateCookie(c)

	provider, err := s.findEnabledOIDCProviderByKey(c.Param("key"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "OIDC 登录方式不存在")
	}
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	code := strings.TrimSpace(c.QueryParam("code"))
	state := strings.TrimSpace(c.QueryParam("state"))
	if code == "" || state == "" {
		return failure(c, http.StatusBadRequest, "invalid_request", "OIDC 回调参数错误")
	}
	if !validateOIDCLoginStateCookie(c, state) {
		return failure(c, http.StatusBadRequest, "invalid_request", "OIDC 登录状态已失效")
	}

	loginState, err := s.consumeOIDCLoginState(provider.ID, state)
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "OIDC 登录状态已失效")
	}

	requestContext := c.Request().Context()
	accessToken, err := exchangeOIDCCode(requestContext, provider, code, loginState.CodeVerifier, oidcCallbackURL(c, provider.Key))
	if err != nil {
		return failure(c, http.StatusUnauthorized, "invalid_oidc_login", "OIDC 登录失败")
	}
	claims, err := fetchOIDCUserInfo(requestContext, provider, accessToken)
	if err != nil {
		return failure(c, http.StatusUnauthorized, "invalid_oidc_login", "OIDC 登录失败")
	}

	user, err := s.findOrCreateOIDCUser(provider, claims)
	if err != nil {
		var userErr oidcUserError
		if errors.As(err, &userErr) {
			return failure(c, userErr.status, userErr.code, userErr.message)
		}

		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if err := s.createUserSession(c, user); err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return c.Redirect(http.StatusFound, loginState.RedirectPath)
}

func (s *Server) findEnabledOIDCProviderByKey(key string) (store.OIDCProvider, error) {
	var provider store.OIDCProvider
	err := s.db.Where("key = ? AND enabled = ?", strings.TrimSpace(key), true).First(&provider).Error
	return provider, err
}

func (s *Server) consumeOIDCLoginState(providerID string, state string) (store.OIDCLoginState, error) {
	stateHash := auth.HashSessionToken(state)
	now := time.Now().UTC()
	var loginState store.OIDCLoginState

	result := s.db.
		Model(&loginState).
		Clauses(clause.Returning{}).
		Where(
			"state_hash = ? AND provider_id = ? AND consumed_at IS NULL AND expires_at > ?",
			stateHash,
			providerID,
			now,
		).
		Update("consumed_at", now)
	if result.Error != nil {
		return store.OIDCLoginState{}, result.Error
	}
	if result.RowsAffected == 0 {
		return store.OIDCLoginState{}, gorm.ErrRecordNotFound
	}

	return loginState, nil
}

func (s *Server) cleanupOIDCLoginStates(now time.Time) error {
	consumedBefore := now.Add(-oidcLoginStateTTL)
	return s.db.
		Where("expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at <= ?)", now, consumedBefore).
		Delete(&store.OIDCLoginState{}).
		Error
}

func (s *Server) findOrCreateOIDCUser(provider store.OIDCProvider, claims map[string]any) (store.User, error) {
	email, err := normalizeEmail(stringFieldFromClaims(claims, provider.EmailField))
	if err != nil {
		return store.User{}, oidcUserError{status: http.StatusBadRequest, code: "invalid_oidc_login", message: "OIDC 邮箱格式错误"}
	}

	var user store.User
	err = s.db.Where("email = ?", email).First(&user).Error
	if err == nil {
		if user.Status != store.UserStatusActive {
			return store.User{}, oidcUserError{status: http.StatusUnauthorized, code: "invalid_credentials", message: "用户已被禁用"}
		}
		return user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return store.User{}, oidcUserError{status: http.StatusInternalServerError, code: "internal_error", message: "服务端错误"}
	}

	phone, err := normalizePhone(stringFieldFromClaims(claims, provider.PhoneField))
	if err != nil {
		return store.User{}, oidcUserError{status: http.StatusBadRequest, code: "invalid_oidc_login", message: "手机号格式错误"}
	}
	if phone != nil {
		var phoneCount int64
		if err := s.db.Model(&store.User{}).Where("phone = ?", *phone).Count(&phoneCount).Error; err != nil {
			return store.User{}, oidcUserError{status: http.StatusInternalServerError, code: "internal_error", message: "服务端错误"}
		}
		if phoneCount > 0 {
			return store.User{}, oidcUserError{status: http.StatusConflict, code: "conflict", message: "手机号已存在"}
		}
	}

	password, err := auth.GenerateInitialPassword(32)
	if err != nil {
		return store.User{}, oidcUserError{status: http.StatusInternalServerError, code: "internal_error", message: "服务端错误"}
	}
	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		return store.User{}, oidcUserError{status: http.StatusInternalServerError, code: "internal_error", message: "服务端错误"}
	}

	name := strings.TrimSpace(stringFieldFromClaims(claims, provider.NameField))
	if name == "" {
		name = emailPrefix(email)
	}
	avatar := normalizeOIDCAvatar(stringFieldFromClaims(claims, provider.AvatarField))
	if avatar == "" {
		avatar = randomBuiltinAvatar()
	}
	user = store.User{
		ID:           uuid.NewString(),
		Avatar:       avatar,
		Email:        email,
		Name:         name,
		Nickname:     strings.TrimSpace(stringFieldFromClaims(claims, provider.NicknameField)),
		Phone:        phone,
		PasswordHash: passwordHash,
		Status:       store.UserStatusActive,
	}
	if err := s.db.Create(&user).Error; err != nil {
		if isUniqueConstraintError(err) {
			return store.User{}, oidcUserError{status: http.StatusConflict, code: "conflict", message: "邮箱或手机号已存在"}
		}
		return store.User{}, oidcUserError{status: http.StatusInternalServerError, code: "internal_error", message: "服务端错误"}
	}

	return user, nil
}

func (s *Server) createUserSession(c echo.Context, user store.User) error {
	token, err := auth.GenerateSessionToken()
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	session := store.UserSession{
		ID:         uuid.NewString(),
		TokenHash:  auth.HashSessionToken(token),
		UserID:     user.ID,
		ExpiresAt:  now.Add(sessionTTL),
		LastSeenAt: now,
		UserAgent:  c.Request().UserAgent(),
		IP:         c.RealIP(),
	}
	if err := s.db.Create(&session).Error; err != nil {
		return err
	}

	setSessionCookie(c, userSessionCookieName, token, session.ExpiresAt)
	return nil
}

func exchangeOIDCCode(ctx context.Context, provider store.OIDCProvider, code string, codeVerifier string, redirectURI string) (string, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("client_id", provider.ClientID)
	form.Set("client_secret", provider.ClientSecret)
	form.Set("code_verifier", codeVerifier)

	requestContext, cancel := context.WithTimeout(ctx, oidcHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestContext, http.MethodPost, provider.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("token endpoint status %d", resp.StatusCode)
	}

	var token oidcTokenResponse
	if err := decodeJSONBody(resp.Body, &token); err != nil {
		return "", err
	}
	if strings.TrimSpace(token.AccessToken) == "" {
		return "", errors.New("access token is empty")
	}

	return token.AccessToken, nil
}

func fetchOIDCUserInfo(ctx context.Context, provider store.OIDCProvider, accessToken string) (map[string]any, error) {
	requestContext, cancel := context.WithTimeout(ctx, oidcHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestContext, http.MethodGet, provider.UserinfoURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("userinfo endpoint status %d", resp.StatusCode)
	}

	var claims map[string]any
	if err := decodeJSONBody(resp.Body, &claims); err != nil {
		return nil, err
	}

	return claims, nil
}

func setOIDCLoginStateCookie(c echo.Context, state string, expiresAt time.Time) {
	c.SetCookie(&http.Cookie{
		Name:     oidcLoginStateCookieName,
		Value:    state,
		Path:     "/api/client/auth/oidc/",
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearOIDCLoginStateCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{
		Name:     oidcLoginStateCookieName,
		Value:    "",
		Path:     "/api/client/auth/oidc/",
		Expires:  time.Unix(0, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func validateOIDCLoginStateCookie(c echo.Context, state string) bool {
	cookie, err := c.Cookie(oidcLoginStateCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return false
	}
	stateHash := auth.HashSessionToken(state)
	cookieStateHash := auth.HashSessionToken(cookie.Value)

	return subtle.ConstantTimeCompare([]byte(stateHash), []byte(cookieStateHash)) == 1
}

func decodeJSONBody(body io.Reader, target any) error {
	decoder := json.NewDecoder(body)
	decoder.UseNumber()
	return decoder.Decode(target)
}

func generateOIDCRandomValue(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(value), nil
}

func oidcCodeChallenge(codeVerifier string) string {
	sum := sha256.Sum256([]byte(codeVerifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func oidcCallbackURL(c echo.Context, providerKey string) string {
	return externalRequestBaseURL(c) + "/api/client/auth/oidc/" + url.PathEscape(providerKey) + "/callback"
}

func externalRequestBaseURL(c echo.Context) string {
	req := c.Request()
	scheme := firstForwardedValue(req.Header.Get("X-Forwarded-Proto"))
	if scheme == "" {
		if req.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	host := firstForwardedValue(req.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = req.Host
	}

	return scheme + "://" + host
}

func firstForwardedValue(value string) string {
	if value == "" {
		return ""
	}
	parts := strings.Split(value, ",")
	return strings.TrimSpace(parts[0])
}

func normalizeOIDCRedirectPath(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "/init", nil
	}
	if !strings.HasPrefix(trimmed, "/") || strings.HasPrefix(trimmed, "//") {
		return "", errors.New("invalid redirect path")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.IsAbs() || parsed.Host != "" {
		return "", errors.New("invalid redirect path")
	}

	return trimmed, nil
}

func stringFieldFromClaims(claims map[string]any, field string) string {
	field = strings.TrimSpace(field)
	if field == "" {
		return ""
	}

	var current any = claims
	for _, part := range strings.Split(field, ".") {
		currentMap, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current = currentMap[part]
	}

	switch value := current.(type) {
	case string:
		return strings.TrimSpace(value)
	case json.Number:
		return value.String()
	default:
		return ""
	}
}

func emailPrefix(email string) string {
	local, _, ok := strings.Cut(email, "@")
	if !ok || strings.TrimSpace(local) == "" {
		return email
	}

	return local
}

func normalizeOIDCAvatar(value string) string {
	trimmed := strings.TrimSpace(value)
	if strings.HasPrefix(trimmed, "https://") || strings.HasPrefix(trimmed, "http://") {
		return trimmed
	}

	return ""
}
