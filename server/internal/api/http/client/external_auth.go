package client

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"app/internal/application/externalauth"

	"github.com/labstack/echo/v4"
)

const (
	externalAuthStateCookieName = "third_party_login_state"
	externalAuthCookiePath      = "/api/client/auth/third-party/"
)

type ExternalAuthAPI struct {
	auth         externalauth.ServiceAPI
	clientOrigin string
}

func NewExternalAuthAPI(auth externalauth.ServiceAPI, clientOrigin string) *ExternalAuthAPI {
	return &ExternalAuthAPI{
		auth:         auth,
		clientOrigin: strings.TrimRight(strings.TrimSpace(clientOrigin), "/"),
	}
}

func (a *ExternalAuthAPI) RegisterPublicRoutes(router *echo.Echo) {
	router.GET("/api/client/auth/third-party/:key/start", a.start)
	router.GET("/api/client/auth/third-party/:key/callback", a.finish)
}

// start godoc
//
// @Summary 发起第三方登录
// @Description 根据登录方式 Key 创建第三方登录状态，并重定向到第三方授权地址。
// @Tags 客户端认证
// @Produce json
// @Param key path string true "第三方登录方式 Key"
// @Param redirect query string false "登录成功后的站内跳转路径"
// @Success 302
// @Failure 400 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/auth/third-party/{key}/start [get]
func (a *ExternalAuthAPI) start(c echo.Context) error {
	result, err := a.auth.Start(c.Request().Context(), externalauth.StartCommand{
		ProviderKey: c.Param("key"), Redirect: c.QueryParam("redirect"), CallbackURLForProvider: a.callbackURLForProvider,
		IP: c.RealIP(), UserAgent: c.Request().UserAgent(),
	})
	if result.State != "" {
		setExternalAuthStateCookie(c, result.State, result.ExpiresAt)
	}
	if err != nil {
		return writeExternalAuthError(c, err)
	}
	return c.Redirect(http.StatusFound, result.AuthorizeURL)
}

// finish godoc
//
// @Summary 完成第三方登录
// @Description 处理第三方登录回调，创建或关联普通用户并写入用户登录 Session。
// @Tags 客户端认证
// @Produce json
// @Param key path string true "第三方登录方式 Key"
// @Param code query string true "第三方授权码"
// @Param state query string true "第三方登录状态"
// @Success 302
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/auth/third-party/{key}/callback [get]
func (a *ExternalAuthAPI) finish(c echo.Context) error {
	defer clearExternalAuthStateCookie(c)
	cookieState := ""
	if cookie, err := c.Cookie(externalAuthStateCookieName); err == nil {
		cookieState = cookie.Value
	}
	result, err := a.auth.Finish(c.Request().Context(), externalauth.FinishCommand{
		ProviderKey: c.Param("key"), Code: callbackCode(c), State: c.QueryParam("state"),
		CookieState: cookieState, CallbackURLForProvider: a.callbackURLForProvider, IP: c.RealIP(), UserAgent: c.Request().UserAgent(),
	})
	if err != nil {
		return writeExternalAuthError(c, err)
	}
	setSessionCookie(c, result.Session.Token, result.Session.ExpiresAt)
	return c.Redirect(http.StatusFound, result.RedirectPath)
}

func (a *ExternalAuthAPI) callbackURLForProvider(providerKey string) string {
	return a.clientOrigin + "/api/client/auth/third-party/" + url.PathEscape(providerKey) + "/callback"
}

func writeExternalAuthError(c echo.Context, err error) error {
	status := http.StatusInternalServerError
	switch externalauth.ErrorCodeOf(err) {
	case externalauth.CodeInvalidRequest:
		status = http.StatusBadRequest
	case externalauth.CodeNotFound:
		status = http.StatusNotFound
	case externalauth.CodeInvalidThirdPartyLogin:
		status = http.StatusBadRequest
		if externalauth.IsOAuthFailure(err) {
			status = http.StatusUnauthorized
		}
	case externalauth.CodeInvalidCredentials:
		status = http.StatusUnauthorized
	case externalauth.CodeConflict:
		status = http.StatusConflict
	}
	return writeFailure(c, status, string(externalauth.ErrorCodeOf(err)), externalauth.ErrorMessage(err))
}

func callbackCode(c echo.Context) string {
	if code := strings.TrimSpace(c.QueryParam("code")); code != "" {
		return code
	}
	return strings.TrimSpace(c.QueryParam("authCode"))
}

func setExternalAuthStateCookie(c echo.Context, state string, expiresAt time.Time) {
	c.SetCookie(&http.Cookie{
		Name: externalAuthStateCookieName, Value: state, Path: externalAuthCookiePath,
		Expires: expiresAt, MaxAge: int(time.Until(expiresAt).Seconds()), HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}

func clearExternalAuthStateCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{
		Name: externalAuthStateCookieName, Value: "", Path: externalAuthCookiePath,
		Expires: time.Unix(0, 0).UTC(), MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}
