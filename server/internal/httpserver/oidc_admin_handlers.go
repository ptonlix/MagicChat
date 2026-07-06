package httpserver

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"unicode"

	"app/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type oidcProviderRequest struct {
	Name          string   `json:"name"`
	AuthorizeURL  string   `json:"authorize_url"`
	TokenURL      string   `json:"token_url"`
	UserinfoURL   string   `json:"userinfo_url"`
	ClientID      string   `json:"client_id"`
	ClientSecret  string   `json:"client_secret"`
	Scopes        []string `json:"scopes"`
	EmailField    string   `json:"email_field"`
	PhoneField    string   `json:"phone_field"`
	NameField     string   `json:"name_field"`
	NicknameField string   `json:"nickname_field"`
	AvatarField   string   `json:"avatar_field"`
}

type oidcProviderMoveRequest struct {
	Direction string `json:"direction"`
}

type oidcProviderResponse struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Key           string   `json:"key"`
	Enabled       bool     `json:"enabled"`
	AuthorizeURL  string   `json:"authorize_url"`
	TokenURL      string   `json:"token_url"`
	UserinfoURL   string   `json:"userinfo_url"`
	ClientID      string   `json:"client_id"`
	ClientSecret  string   `json:"client_secret"`
	Scopes        []string `json:"scopes"`
	EmailField    string   `json:"email_field"`
	PhoneField    string   `json:"phone_field"`
	NameField     string   `json:"name_field"`
	NicknameField string   `json:"nickname_field"`
	AvatarField   string   `json:"avatar_field"`
	SortOrder     int      `json:"sort_order"`
}

type listOIDCProvidersResponse struct {
	Providers []oidcProviderResponse `json:"providers"`
}

type oidcProviderEnvelope struct {
	Provider oidcProviderResponse `json:"provider"`
}

// listOIDCProviders godoc
//
// @Summary 列出 OIDC 登录方式
// @Description 管理员读取已配置的 OIDC 登录方式，包含 Client Secret。
// @Tags 管理员 OIDC
// @Produce json
// @Success 200 {object} successEnvelope{data=listOIDCProvidersResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/oidc/providers [get]
func (s *Server) listOIDCProviders(c echo.Context) error {
	var providers []store.OIDCProvider
	if err := s.db.Order("sort_order ASC").Order("name ASC").Order("id ASC").Find(&providers).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	responses := make([]oidcProviderResponse, 0, len(providers))
	for _, provider := range providers {
		response, err := newOIDCProviderResponse(provider)
		if err != nil {
			return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
		}
		responses = append(responses, response)
	}

	return success(c, http.StatusOK, listOIDCProvidersResponse{
		Providers: responses,
	})
}

// createOIDCProvider godoc
//
// @Summary 创建 OIDC 登录方式
// @Description 管理员创建一个普通用户可用的 OIDC 登录方式。
// @Tags 管理员 OIDC
// @Accept json
// @Produce json
// @Param body body oidcProviderRequest true "OIDC 登录方式"
// @Success 201 {object} successEnvelope{data=oidcProviderEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/oidc/providers [post]
func (s *Server) createOIDCProvider(c echo.Context) error {
	var req oidcProviderRequest
	if err := c.Bind(&req); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}

	provider, err := newOIDCProviderFromRequest(req)
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}
	provider.ID = uuid.NewString()
	provider.Enabled = true

	key, err := s.generateUniqueOIDCProviderKey(provider.Name)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	provider.Key = key

	sortOrder, err := s.nextOIDCProviderSortOrder()
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	provider.SortOrder = sortOrder

	if err := s.db.Create(&provider).Error; err != nil {
		if isUniqueConstraintError(err) {
			return failure(c, http.StatusConflict, "conflict", "OIDC 登录方式标识已存在")
		}
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	response, err := newOIDCProviderResponse(provider)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusCreated, oidcProviderEnvelope{Provider: response})
}

// updateOIDCProvider godoc
//
// @Summary 更新 OIDC 登录方式
// @Description 管理员更新一个 OIDC 登录方式。Client Secret 每次更新都需要提交完整值。
// @Tags 管理员 OIDC
// @Accept json
// @Produce json
// @Param id path string true "OIDC 登录方式 ID"
// @Param body body oidcProviderRequest true "OIDC 登录方式"
// @Success 200 {object} successEnvelope{data=oidcProviderEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/oidc/providers/{id} [put]
func (s *Server) updateOIDCProvider(c echo.Context) error {
	id, err := parseUUIDParam(c, "id", "OIDC 登录方式 ID 格式错误")
	if err != nil {
		return err
	}

	var provider store.OIDCProvider
	err = s.db.First(&provider, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "OIDC 登录方式不存在")
	}
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	var req oidcProviderRequest
	if err := c.Bind(&req); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}

	updatedProvider, err := newOIDCProviderFromRequest(req)
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}
	updates := map[string]any{
		"name":           updatedProvider.Name,
		"authorize_url":  updatedProvider.AuthorizeURL,
		"token_url":      updatedProvider.TokenURL,
		"userinfo_url":   updatedProvider.UserinfoURL,
		"client_id":      updatedProvider.ClientID,
		"client_secret":  updatedProvider.ClientSecret,
		"scopes":         updatedProvider.Scopes,
		"email_field":    updatedProvider.EmailField,
		"phone_field":    updatedProvider.PhoneField,
		"name_field":     updatedProvider.NameField,
		"nickname_field": updatedProvider.NicknameField,
		"avatar_field":   updatedProvider.AvatarField,
	}
	if err := s.db.Model(&provider).Updates(updates).Error; err != nil {
		if isUniqueConstraintError(err) {
			return failure(c, http.StatusConflict, "conflict", "OIDC 登录方式标识已存在")
		}
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	if err := s.db.First(&provider, "id = ?", id).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	response, err := newOIDCProviderResponse(provider)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, oidcProviderEnvelope{Provider: response})
}

// enableOIDCProvider godoc
//
// @Summary 启用 OIDC 登录方式
// @Description 管理员启用一个 OIDC 登录方式。
// @Tags 管理员 OIDC
// @Produce json
// @Param id path string true "OIDC 登录方式 ID"
// @Success 200 {object} successEnvelope{data=oidcProviderEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/oidc/providers/{id}/enable [post]
func (s *Server) enableOIDCProvider(c echo.Context) error {
	return s.updateOIDCProviderEnabled(c, true)
}

// disableOIDCProvider godoc
//
// @Summary 禁用 OIDC 登录方式
// @Description 管理员禁用一个 OIDC 登录方式。
// @Tags 管理员 OIDC
// @Produce json
// @Param id path string true "OIDC 登录方式 ID"
// @Success 200 {object} successEnvelope{data=oidcProviderEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/oidc/providers/{id}/disable [post]
func (s *Server) disableOIDCProvider(c echo.Context) error {
	return s.updateOIDCProviderEnabled(c, false)
}

// moveOIDCProvider godoc
//
// @Summary 移动 OIDC 登录方式
// @Description 管理员将一个 OIDC 登录方式上移或下移，服务端会重新归一化所有登录方式的排序值。
// @Tags 管理员 OIDC
// @Accept json
// @Produce json
// @Param id path string true "OIDC 登录方式 ID"
// @Param body body oidcProviderMoveRequest true "移动方向"
// @Success 200 {object} successEnvelope{data=listOIDCProvidersResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/oidc/providers/{id}/move [post]
func (s *Server) moveOIDCProvider(c echo.Context) error {
	id, err := parseUUIDParam(c, "id", "OIDC 登录方式 ID 格式错误")
	if err != nil {
		return err
	}

	var req oidcProviderMoveRequest
	if err := c.Bind(&req); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	direction := strings.TrimSpace(req.Direction)
	if direction != "up" && direction != "down" {
		return failure(c, http.StatusBadRequest, "invalid_request", "移动方向只能是 up 或 down")
	}

	var responses []oidcProviderResponse
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var providers []store.OIDCProvider
		if err := tx.Order("sort_order ASC").Order("name ASC").Order("id ASC").Find(&providers).Error; err != nil {
			return err
		}

		index := -1
		for currentIndex, provider := range providers {
			if provider.ID == id {
				index = currentIndex
				break
			}
		}
		if index == -1 {
			return gorm.ErrRecordNotFound
		}

		targetIndex := index
		if direction == "up" && index > 0 {
			targetIndex = index - 1
		}
		if direction == "down" && index < len(providers)-1 {
			targetIndex = index + 1
		}
		providers[index], providers[targetIndex] = providers[targetIndex], providers[index]

		responses = make([]oidcProviderResponse, 0, len(providers))
		for currentIndex := range providers {
			sortOrder := (currentIndex + 1) * 10
			if err := tx.Model(&store.OIDCProvider{}).
				Where("id = ?", providers[currentIndex].ID).
				Update("sort_order", sortOrder).Error; err != nil {
				return err
			}
			providers[currentIndex].SortOrder = sortOrder

			response, err := newOIDCProviderResponse(providers[currentIndex])
			if err != nil {
				return err
			}
			responses = append(responses, response)
		}

		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "OIDC 登录方式不存在")
	}
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, listOIDCProvidersResponse{Providers: responses})
}

// deleteOIDCProvider godoc
//
// @Summary 删除 OIDC 登录方式
// @Description 管理员删除一个 OIDC 登录方式。
// @Tags 管理员 OIDC
// @Produce json
// @Param id path string true "OIDC 登录方式 ID"
// @Success 200 {object} successEnvelope
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/oidc/providers/{id} [delete]
func (s *Server) deleteOIDCProvider(c echo.Context) error {
	id, err := parseUUIDParam(c, "id", "OIDC 登录方式 ID 格式错误")
	if err != nil {
		return err
	}

	var provider store.OIDCProvider
	err = s.db.First(&provider, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "OIDC 登录方式不存在")
	}
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if err := s.db.Delete(&provider).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, map[string]any{})
}

func (s *Server) updateOIDCProviderEnabled(c echo.Context, enabled bool) error {
	id, err := parseUUIDParam(c, "id", "OIDC 登录方式 ID 格式错误")
	if err != nil {
		return err
	}

	var provider store.OIDCProvider
	err = s.db.First(&provider, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "OIDC 登录方式不存在")
	}
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if err := s.db.Model(&provider).Update("enabled", enabled).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	provider.Enabled = enabled

	response, err := newOIDCProviderResponse(provider)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, oidcProviderEnvelope{Provider: response})
}

func newOIDCProviderFromRequest(req oidcProviderRequest) (store.OIDCProvider, error) {
	scopes, err := normalizeOIDCScopes(req.Scopes)
	if err != nil {
		return store.OIDCProvider{}, err
	}
	scopesJSON, err := json.Marshal(scopes)
	if err != nil {
		return store.OIDCProvider{}, err
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		return store.OIDCProvider{}, errors.New("名称不能为空")
	}
	authorizeURL, err := normalizeHTTPURL(req.AuthorizeURL, "Authorize URL 格式错误")
	if err != nil {
		return store.OIDCProvider{}, err
	}
	tokenURL, err := normalizeHTTPURL(req.TokenURL, "Access Token URL 格式错误")
	if err != nil {
		return store.OIDCProvider{}, err
	}
	userinfoURL, err := normalizeHTTPURL(req.UserinfoURL, "用户信息 URL 格式错误")
	if err != nil {
		return store.OIDCProvider{}, err
	}
	clientID := strings.TrimSpace(req.ClientID)
	if clientID == "" {
		return store.OIDCProvider{}, errors.New("Client ID 不能为空")
	}
	clientSecret := strings.TrimSpace(req.ClientSecret)
	if clientSecret == "" {
		return store.OIDCProvider{}, errors.New("Client Secret 不能为空")
	}
	emailField := strings.TrimSpace(req.EmailField)
	if emailField == "" {
		return store.OIDCProvider{}, errors.New("邮箱字段名不能为空")
	}
	nameField := strings.TrimSpace(req.NameField)
	if nameField == "" {
		return store.OIDCProvider{}, errors.New("姓名字段名不能为空")
	}

	return store.OIDCProvider{
		Name:          name,
		AuthorizeURL:  authorizeURL,
		TokenURL:      tokenURL,
		UserinfoURL:   userinfoURL,
		ClientID:      clientID,
		ClientSecret:  clientSecret,
		Scopes:        scopesJSON,
		EmailField:    emailField,
		PhoneField:    strings.TrimSpace(req.PhoneField),
		NameField:     nameField,
		NicknameField: strings.TrimSpace(req.NicknameField),
		AvatarField:   strings.TrimSpace(req.AvatarField),
	}, nil
}

func newOIDCProviderResponse(provider store.OIDCProvider) (oidcProviderResponse, error) {
	scopes, err := parseOIDCScopes(provider.Scopes)
	if err != nil {
		return oidcProviderResponse{}, err
	}

	return oidcProviderResponse{
		ID:            provider.ID,
		Name:          provider.Name,
		Key:           provider.Key,
		Enabled:       provider.Enabled,
		AuthorizeURL:  provider.AuthorizeURL,
		TokenURL:      provider.TokenURL,
		UserinfoURL:   provider.UserinfoURL,
		ClientID:      provider.ClientID,
		ClientSecret:  provider.ClientSecret,
		Scopes:        scopes,
		EmailField:    provider.EmailField,
		PhoneField:    provider.PhoneField,
		NameField:     provider.NameField,
		NicknameField: provider.NicknameField,
		AvatarField:   provider.AvatarField,
		SortOrder:     provider.SortOrder,
	}, nil
}

func normalizeOIDCScopes(rawScopes []string) ([]string, error) {
	if len(rawScopes) == 0 {
		return nil, errors.New("Scope 不能为空")
	}

	seen := map[string]struct{}{}
	scopes := make([]string, 0, len(rawScopes))
	for _, rawScope := range rawScopes {
		scope := strings.TrimSpace(rawScope)
		if scope == "" {
			continue
		}
		if strings.ContainsAny(scope, " \t\r\n") {
			return nil, errors.New("Scope 不能包含空白字符")
		}
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		scopes = append(scopes, scope)
	}
	if len(scopes) == 0 {
		return nil, errors.New("Scope 不能为空")
	}

	return scopes, nil
}

func (s *Server) generateUniqueOIDCProviderKey(name string) (string, error) {
	base := slugifyOIDCProviderKey(name)
	if base == "" {
		base = "oidc"
	}
	if len(base) > 80 {
		base = strings.Trim(base[:80], "-_")
	}
	if base == "" {
		base = "oidc"
	}

	key := base
	for attempt := 0; attempt < 8; attempt++ {
		var count int64
		if err := s.db.Model(&store.OIDCProvider{}).Where("key = ?", key).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return key, nil
		}

		suffix, err := randomOIDCProviderKeySuffix()
		if err != nil {
			return "", err
		}
		prefixMaxLength := 80 - len(suffix) - 1
		prefix := base
		if len(prefix) > prefixMaxLength {
			prefix = strings.Trim(prefix[:prefixMaxLength], "-_")
		}
		if prefix == "" {
			prefix = "oidc"
		}
		key = prefix + "-" + suffix
	}

	return "", errors.New("generate unique oidc provider key")
}

func (s *Server) nextOIDCProviderSortOrder() (int, error) {
	var maxSortOrder sql.NullInt64
	if err := s.db.Model(&store.OIDCProvider{}).Select("MAX(sort_order)").Scan(&maxSortOrder).Error; err != nil {
		return 0, err
	}
	if !maxSortOrder.Valid {
		return 10, nil
	}

	return int(maxSortOrder.Int64) + 10, nil
}

func slugifyOIDCProviderKey(name string) string {
	var builder strings.Builder
	lastSeparator := true
	for _, currentRune := range strings.ToLower(name) {
		switch {
		case currentRune >= 'a' && currentRune <= 'z':
			builder.WriteRune(currentRune)
			lastSeparator = false
		case currentRune >= '0' && currentRune <= '9':
			builder.WriteRune(currentRune)
			lastSeparator = false
		case currentRune == '-' || currentRune == '_' || unicode.IsSpace(currentRune):
			if !lastSeparator {
				builder.WriteByte('-')
				lastSeparator = true
			}
		}
	}

	return strings.Trim(builder.String(), "-_")
}

func randomOIDCProviderKeySuffix() (string, error) {
	var value [4]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}

	return hex.EncodeToString(value[:]), nil
}

func parseOIDCScopes(raw json.RawMessage) ([]string, error) {
	var scopes []string
	if err := json.Unmarshal(raw, &scopes); err != nil {
		return nil, err
	}

	return scopes, nil
}

func normalizeHTTPURL(value string, message string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", errors.New(message)
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New(message)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", errors.New(message)
	}

	return trimmed, nil
}

func parseUUIDParam(c echo.Context, paramName string, message string) (string, error) {
	id := strings.TrimSpace(c.Param(paramName))
	if _, err := uuid.Parse(id); err != nil {
		return "", failure(c, http.StatusBadRequest, "invalid_request", message)
	}

	return id, nil
}
