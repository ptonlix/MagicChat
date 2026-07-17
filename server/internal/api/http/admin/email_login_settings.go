package admin

import (
	"net/http"

	"app/internal/application/emailauth"
	settingsapp "app/internal/application/settings"

	"github.com/labstack/echo/v4"
)

type EmailLoginSettingsAPI struct {
	settings settingsapp.EmailLoginSettingsService
	tester   emailauth.SMTPTester
}

type emailLoginSettingsResponse struct {
	Enabled                bool   `json:"enabled"`
	SMTPHost               string `json:"smtp_host" example:"smtp.example.com"`
	SMTPPort               int    `json:"smtp_port" example:"587"`
	SMTPSecurity           string `json:"smtp_security" example:"starttls"`
	SMTPUsername           string `json:"smtp_username" example:"mailer@example.com"`
	SMTPPassword           string `json:"smtp_password"`
	SMTPPasswordConfigured bool   `json:"smtp_password_configured"`
	FromEmail              string `json:"from_email" example:"mailer@example.com"`
	FromName               string `json:"from_name" example:"即应"`
}

type updateEmailLoginSettingsRequest struct {
	Enabled      bool    `json:"enabled"`
	SMTPHost     string  `json:"smtp_host"`
	SMTPPort     int     `json:"smtp_port"`
	SMTPSecurity string  `json:"smtp_security"`
	SMTPUsername string  `json:"smtp_username"`
	SMTPPassword *string `json:"smtp_password"`
	FromEmail    string  `json:"from_email"`
	FromName     string  `json:"from_name"`
}

type testEmailLoginSettingsRequest struct {
	RecipientEmail string `json:"recipient_email" example:"admin@example.com"`
}

func NewEmailLoginSettingsAPI(settings settingsapp.EmailLoginSettingsService, tester emailauth.SMTPTester) *EmailLoginSettingsAPI {
	return &EmailLoginSettingsAPI{settings: settings, tester: tester}
}

func (a *EmailLoginSettingsAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/settings/email-login", a.get)
	group.PUT("/settings/email-login", a.update)
	group.POST("/settings/email-login/test", a.test)
}

// test godoc
//
// @Summary 发送 SMTP 测试邮件
// @Description 管理员使用已保存的 SMTP 配置发送测试邮件。失败时返回可诊断的错误原因。
// @Tags 管理员设置
// @Accept json
// @Produce json
// @Param body body testEmailLoginSettingsRequest true "测试收件邮箱"
// @Success 200 {object} successEnvelope
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 502 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/settings/email-login/test [post]
func (a *EmailLoginSettingsAPI) test(c echo.Context) error {
	var req testEmailLoginSettingsRequest
	if err := c.Bind(&req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(emailauth.CodeInvalidRequest), "请求格式错误")
	}
	if err := a.tester.TestSMTP(c.Request().Context(), req.RecipientEmail); err != nil {
		return writeSMTPTestError(c, err)
	}
	return writeSuccess(c, http.StatusOK, map[string]any{})
}

// get godoc
//
// @Summary 获取邮箱验证码登录设置
// @Description 管理员读取邮箱验证码登录和完整 SMTP 设置，包括已保存的 SMTP 密码。
// @Tags 管理员设置
// @Produce json
// @Success 200 {object} successEnvelope{data=emailLoginSettingsResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/settings/email-login [get]
func (a *EmailLoginSettingsAPI) get(c echo.Context) error {
	value, err := a.settings.GetEmailLogin(c.Request().Context())
	if err != nil {
		return writeSettingsError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newEmailLoginSettingsResponse(value))
}

// update godoc
//
// @Summary 更新邮箱验证码登录设置
// @Description 管理员配置邮箱验证码登录和 SMTP。省略 smtp_password 时保留原密码。
// @Tags 管理员设置
// @Accept json
// @Produce json
// @Param body body updateEmailLoginSettingsRequest true "邮箱登录设置"
// @Success 200 {object} successEnvelope{data=emailLoginSettingsResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/settings/email-login [put]
func (a *EmailLoginSettingsAPI) update(c echo.Context) error {
	var req updateEmailLoginSettingsRequest
	if err := c.Bind(&req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(settingsapp.CodeInvalidRequest), "请求格式错误")
	}
	value, err := a.settings.UpdateEmailLogin(c.Request().Context(), settingsapp.UpdateEmailLoginCommand{
		Enabled: req.Enabled, SMTPHost: req.SMTPHost, SMTPPort: req.SMTPPort,
		SMTPSecurity: req.SMTPSecurity, SMTPUsername: req.SMTPUsername,
		SMTPPassword: req.SMTPPassword, FromEmail: req.FromEmail, FromName: req.FromName,
	})
	if err != nil {
		return writeSettingsError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newEmailLoginSettingsResponse(value))
}

func newEmailLoginSettingsResponse(value settingsapp.EmailLoginSettings) emailLoginSettingsResponse {
	return emailLoginSettingsResponse{
		Enabled: value.Enabled, SMTPHost: value.SMTPHost, SMTPPort: value.SMTPPort,
		SMTPSecurity: value.SMTPSecurity, SMTPUsername: value.SMTPUsername,
		SMTPPassword: value.SMTPPassword, SMTPPasswordConfigured: value.SMTPPassword != "",
		FromEmail: value.FromEmail, FromName: value.FromName,
	}
}

func writeSMTPTestError(c echo.Context, err error) error {
	status := http.StatusInternalServerError
	switch emailauth.ErrorCodeOf(err) {
	case emailauth.CodeInvalidRequest:
		status = http.StatusBadRequest
	case emailauth.CodeUnavailable:
		status = http.StatusBadGateway
	}
	return writeFailure(c, status, string(emailauth.ErrorCodeOf(err)), emailauth.ErrorMessage(err))
}
