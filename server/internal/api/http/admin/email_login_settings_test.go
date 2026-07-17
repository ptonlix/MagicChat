package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"app/internal/application/emailauth"
	settingsapp "app/internal/application/settings"

	"github.com/labstack/echo/v4"
)

func TestEmailLoginSettingsAPIReturnsPasswordAndMapsUpdate(t *testing.T) {
	service := &fakeEmailLoginSettingsService{value: settingsapp.EmailLoginSettings{
		Enabled: true, SMTPHost: "smtp.example.com", SMTPPort: 587,
		SMTPSecurity: settingsapp.SMTPSecuritySTARTTLS, SMTPUsername: "mailer@example.com",
		SMTPPassword: "smtp-secret", FromEmail: "mailer@example.com", FromName: "即应通知",
	}}
	tester := &fakeSMTPTester{}
	api := NewEmailLoginSettingsAPI(service, tester)
	router := echo.New()
	api.RegisterRoutes(router.Group("/api/admin"))

	request := httptest.NewRequest(http.MethodGet, "/api/admin/settings/email-login", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode get response: %v", err)
	}
	data := payload["data"].(map[string]any)
	if data["smtp_password"] != "smtp-secret" || data["smtp_password_configured"] != true || data["smtp_host"] != "smtp.example.com" {
		t.Fatalf("get response = %#v", data)
	}

	body := bytes.NewBufferString(`{"enabled":true,"smtp_host":"smtp.new.test","smtp_port":465,"smtp_security":"tls","smtp_username":"mailer","smtp_password":"new-secret","from_email":"from@example.com","from_name":"即应"}`)
	request = httptest.NewRequest(http.MethodPut, "/api/admin/settings/email-login", body)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("update status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if service.command.SMTPHost != "smtp.new.test" || service.command.SMTPPassword == nil || *service.command.SMTPPassword != "new-secret" {
		t.Fatalf("update command = %#v", service.command)
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode update response: %v", err)
	}
	data = payload["data"].(map[string]any)
	if data["smtp_password"] != "new-secret" || data["smtp_password_configured"] != true {
		t.Fatalf("update response = %#v", data)
	}

	body = bytes.NewBufferString(`{"recipient_email":"admin@example.com"}`)
	request = httptest.NewRequest(http.MethodPost, "/api/admin/settings/email-login/test", body)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || tester.recipient != "admin@example.com" {
		t.Fatalf("test status = %d, recipient = %q, body = %s", recorder.Code, tester.recipient, recorder.Body.String())
	}
}

func TestEmailLoginSettingsAPIReturnsSMTPTestFailure(t *testing.T) {
	api := NewEmailLoginSettingsAPI(&fakeEmailLoginSettingsService{}, &fakeSMTPTester{
		err: &emailauth.Error{Code: emailauth.CodeUnavailable, Message: "SMTP 测试失败"},
	})
	router := echo.New()
	api.RegisterRoutes(router.Group("/api/admin"))
	request := httptest.NewRequest(http.MethodPost, "/api/admin/settings/email-login/test", bytes.NewBufferString(`{"recipient_email":"admin@example.com"}`))
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadGateway || !strings.Contains(recorder.Body.String(), "SMTP 测试失败") {
		t.Fatalf("test status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

type fakeEmailLoginSettingsService struct {
	value   settingsapp.EmailLoginSettings
	command settingsapp.UpdateEmailLoginCommand
}

func (s *fakeEmailLoginSettingsService) GetEmailLogin(context.Context) (settingsapp.EmailLoginSettings, error) {
	return s.value, nil
}

func (s *fakeEmailLoginSettingsService) UpdateEmailLogin(_ context.Context, cmd settingsapp.UpdateEmailLoginCommand) (settingsapp.EmailLoginSettings, error) {
	s.command = cmd
	s.value = settingsapp.EmailLoginSettings{
		Enabled: cmd.Enabled, SMTPHost: cmd.SMTPHost, SMTPPort: cmd.SMTPPort,
		SMTPSecurity: cmd.SMTPSecurity, SMTPUsername: cmd.SMTPUsername,
		FromEmail: cmd.FromEmail, FromName: cmd.FromName,
	}
	if cmd.SMTPPassword != nil {
		s.value.SMTPPassword = *cmd.SMTPPassword
	}
	return s.value, nil
}

type fakeSMTPTester struct {
	recipient string
	err       error
}

func (t *fakeSMTPTester) TestSMTP(_ context.Context, recipient string) error {
	t.recipient = recipient
	return t.err
}
