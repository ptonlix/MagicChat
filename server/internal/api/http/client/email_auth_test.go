package client

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"app/internal/application/account"
	"app/internal/application/emailauth"

	"github.com/labstack/echo/v4"
)

func TestEmailAuthAPIRequestsCodeAndLogsIn(t *testing.T) {
	now := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	service := &fakeEmailAuthService{loginResult: account.LoginResult{
		Account: account.Account{ID: "user-1", Email: "alice@example.com", Name: "Alice", CreatedAt: now},
		Session: account.SessionCredential{Token: "email-session", ExpiresAt: now.Add(time.Hour)},
	}}
	api := NewEmailAuthAPI(service)
	router := echo.New()
	api.RegisterPublicRoutes(router)

	request := httptest.NewRequest(http.MethodPost, "/api/client/auth/email-code/request", bytes.NewBufferString(`{"email":"alice@example.com"}`))
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	request.Header.Set("X-Forwarded-For", "203.0.113.10")
	request.RemoteAddr = "127.0.0.1:1234"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || service.requestCommand.Email != "alice@example.com" || service.requestCommand.IP != "127.0.0.1" {
		t.Fatalf("request status = %d, command = %#v, body = %s", recorder.Code, service.requestCommand, recorder.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, "/api/client/auth/email-code/login", bytes.NewBufferString(`{"email":"alice@example.com","code":"01234567"}`))
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	request.Header.Set("User-Agent", "email-auth-test")
	request.RemoteAddr = "127.0.0.1:1234"
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || service.loginCommand.Code != "01234567" || service.loginCommand.UserAgent != "email-auth-test" {
		t.Fatalf("login status = %d, command = %#v, body = %s", recorder.Code, service.loginCommand, recorder.Body.String())
	}
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != UserSessionCookieName || cookies[0].Value != "email-session" {
		t.Fatalf("cookies = %#v", cookies)
	}
}

type fakeEmailAuthService struct {
	requestCommand emailauth.RequestCodeCommand
	loginCommand   emailauth.LoginCommand
	loginResult    account.LoginResult
}

func (s *fakeEmailAuthService) RequestCode(_ context.Context, cmd emailauth.RequestCodeCommand) (emailauth.RequestCodeResult, error) {
	s.requestCommand = cmd
	return emailauth.RequestCodeResult{ExpiresInSeconds: 900, RetryAfterSeconds: 5}, nil
}

func (s *fakeEmailAuthService) Login(_ context.Context, cmd emailauth.LoginCommand) (account.LoginResult, error) {
	s.loginCommand = cmd
	return s.loginResult, nil
}
