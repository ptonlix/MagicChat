package client

import (
	"net"
	"net/http"
	"strconv"
	"strings"

	"app/internal/application/emailauth"

	"github.com/labstack/echo/v4"
)

type EmailAuthAPI struct {
	service emailauth.ServiceAPI
}

type requestEmailCodeRequest struct {
	Email string `json:"email" example:"user@example.com"`
}

type emailCodeLoginRequest struct {
	Email string `json:"email" example:"user@example.com"`
	Code  string `json:"code" example:"01234567"`
}

type requestEmailCodeResponse struct {
	ExpiresInSeconds  int `json:"expires_in_seconds" example:"900"`
	RetryAfterSeconds int `json:"retry_after_seconds" example:"5"`
}

func NewEmailAuthAPI(service emailauth.ServiceAPI) *EmailAuthAPI {
	return &EmailAuthAPI{service: service}
}

func (a *EmailAuthAPI) RegisterPublicRoutes(router *echo.Echo) {
	router.POST("/api/client/auth/email-code/request", a.requestCode)
	router.POST("/api/client/auth/email-code/login", a.login)
}

// requestCode godoc
//
// @Summary 发送邮箱登录验证码
// @Description 请求发送 8 位登录验证码。验证码 15 分钟内有效，同一直连 IP 与邮箱组合 5 秒内不能重复发送。
// @Tags 客户端认证
// @Accept json
// @Produce json
// @Param body body requestEmailCodeRequest true "邮箱"
// @Success 200 {object} successEnvelope{data=requestEmailCodeResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 429 {object} errorEnvelope
// @Failure 503 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/auth/email-code/request [post]
func (a *EmailAuthAPI) requestCode(c echo.Context) error {
	var req requestEmailCodeRequest
	if err := c.Bind(&req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(emailauth.CodeInvalidRequest), "请求格式错误")
	}
	result, err := a.service.RequestCode(c.Request().Context(), emailauth.RequestCodeCommand{
		Email: req.Email,
		IP:    directClientIP(c.Request()),
	})
	if err != nil {
		return writeEmailAuthError(c, err)
	}
	return writeSuccess(c, http.StatusOK, requestEmailCodeResponse{
		ExpiresInSeconds: result.ExpiresInSeconds, RetryAfterSeconds: result.RetryAfterSeconds,
	})
}

// login godoc
//
// @Summary 使用邮箱验证码登录
// @Description 验证 8 位邮箱验证码，创建普通用户 Session 并写入登录 Cookie。验证码仅能使用一次。
// @Tags 客户端认证
// @Accept json
// @Produce json
// @Param body body emailCodeLoginRequest true "邮箱和验证码"
// @Success 200 {object} successEnvelope{data=accountEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 503 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/auth/email-code/login [post]
func (a *EmailAuthAPI) login(c echo.Context) error {
	var req emailCodeLoginRequest
	if err := c.Bind(&req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(emailauth.CodeInvalidRequest), "请求格式错误")
	}
	result, err := a.service.Login(c.Request().Context(), emailauth.LoginCommand{
		Email: req.Email, Code: req.Code, UserAgent: c.Request().UserAgent(), IP: directClientIP(c.Request()),
	})
	if err != nil {
		return writeEmailAuthError(c, err)
	}
	setSessionCookie(c, result.Session.Token, result.Session.ExpiresAt)
	return writeSuccess(c, http.StatusOK, accountEnvelope{Account: newAccountResponse(result.Account)})
}

func directClientIP(request *http.Request) string {
	remoteAddress := strings.TrimSpace(request.RemoteAddr)
	host, _, err := net.SplitHostPort(remoteAddress)
	if err == nil {
		return host
	}
	return strings.Trim(remoteAddress, "[]")
}

func writeEmailAuthError(c echo.Context, err error) error {
	status := http.StatusInternalServerError
	switch emailauth.ErrorCodeOf(err) {
	case emailauth.CodeInvalidRequest:
		status = http.StatusBadRequest
	case emailauth.CodeInvalidCode:
		status = http.StatusUnauthorized
	case emailauth.CodeTooManyRequests:
		status = http.StatusTooManyRequests
		if retryAfter := emailauth.RetryAfterOf(err); retryAfter > 0 {
			c.Response().Header().Set("Retry-After", strconv.Itoa(retryAfter))
		}
	case emailauth.CodeUnavailable:
		status = http.StatusServiceUnavailable
	}
	return writeFailure(c, status, string(emailauth.ErrorCodeOf(err)), emailauth.ErrorMessage(err))
}
