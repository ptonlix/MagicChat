package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"app/internal/application/externalauth"

	"github.com/labstack/echo/v4"
)

func TestExternalAuthAPIUsesConfiguredCallbackOriginAndKeepsCookieProtocol(t *testing.T) {
	expiresAt := time.Now().UTC().Add(10 * time.Minute)
	service := &externalAuthServiceStub{
		startResult: externalauth.StartResult{
			AuthorizeURL: "https://sso.test/authorize", State: "login-state", ExpiresAt: expiresAt,
		},
		finishResult: externalauth.FinishResult{
			RedirectPath: "/init",
			Session: externalauth.SessionCredential{
				Token: "user-session-token", ExpiresAt: expiresAt.Add(7 * 24 * time.Hour),
			},
		},
	}
	router := echo.New()
	NewExternalAuthAPI(service, "https://chat.example.com:8443/").RegisterPublicRoutes(router)

	request := httptest.NewRequest(http.MethodGet, "/api/client/auth/third-party/request-key/start?redirect=/projects", nil)
	request.Host = "attacker.example"
	request.Header.Set("X-Forwarded-Proto", "http")
	request.Header.Set("X-Forwarded-Host", "attacker.example")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusFound || recorder.Header().Get("Location") != "https://sso.test/authorize" {
		t.Fatalf("start status = %d, location = %q, body = %s", recorder.Code, recorder.Header().Get("Location"), recorder.Body.String())
	}
	if service.startCommand.ProviderKey != "request-key" || service.startCommand.Redirect != "/projects" ||
		service.startCallbackURL != "https://chat.example.com:8443/api/client/auth/third-party/canonical-key/callback" {
		t.Fatalf("start command = %#v, callback = %q", service.startCommand, service.startCallbackURL)
	}
	startCookies := recorder.Result().Cookies()
	if len(startCookies) != 1 || startCookies[0].Name != externalAuthStateCookieName || startCookies[0].Value != "login-state" ||
		startCookies[0].Path != externalAuthCookiePath || !startCookies[0].HttpOnly || startCookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("start cookies = %#v", startCookies)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/client/auth/third-party/request-key/callback?authCode=callback-code&state=login-state", nil)
	request.Host = "attacker.example"
	request.Header.Set("X-Forwarded-Proto", "http")
	request.Header.Set("X-Forwarded-Host", "attacker.example")
	request.AddCookie(&http.Cookie{Name: externalAuthStateCookieName, Value: "login-state", Path: externalAuthCookiePath})
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusFound || recorder.Header().Get("Location") != "/init" {
		t.Fatalf("finish status = %d, location = %q, body = %s", recorder.Code, recorder.Header().Get("Location"), recorder.Body.String())
	}
	if service.finishCommand.Code != "callback-code" || service.finishCommand.CookieState != "login-state" ||
		service.finishCallbackURL != "https://chat.example.com:8443/api/client/auth/third-party/canonical-key/callback" {
		t.Fatalf("finish command = %#v, callback = %q", service.finishCommand, service.finishCallbackURL)
	}
	finishCookies := recorder.Result().Cookies()
	if len(finishCookies) != 1 || finishCookies[0].Name != UserSessionCookieName || finishCookies[0].Value != "user-session-token" {
		t.Fatalf("finish cookies = %#v", finishCookies)
	}
}

type externalAuthServiceStub struct {
	startResult       externalauth.StartResult
	finishResult      externalauth.FinishResult
	startCommand      externalauth.StartCommand
	finishCommand     externalauth.FinishCommand
	startCallbackURL  string
	finishCallbackURL string
}

func (s *externalAuthServiceStub) Start(_ context.Context, cmd externalauth.StartCommand) (externalauth.StartResult, error) {
	s.startCommand = cmd
	s.startCallbackURL = cmd.CallbackURLForProvider("canonical-key")
	return s.startResult, nil
}

func (s *externalAuthServiceStub) Finish(_ context.Context, cmd externalauth.FinishCommand) (externalauth.FinishResult, error) {
	s.finishCommand = cmd
	s.finishCallbackURL = cmd.CallbackURLForProvider("canonical-key")
	return s.finishResult, nil
}
