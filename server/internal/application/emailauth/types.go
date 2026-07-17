package emailauth

import (
	"context"
	"time"

	"app/internal/application/account"
	settingsapp "app/internal/application/settings"
)

const (
	CodeLength        = 8
	CodeTTL           = 15 * time.Minute
	SendCooldown      = 5 * time.Second
	MaxFailedAttempts = 5
	CleanupInterval   = time.Minute
)

type RequestCodeCommand struct {
	Email string
	IP    string
}

type RequestCodeResult struct {
	ExpiresInSeconds  int
	RetryAfterSeconds int
}

type LoginCommand struct {
	Email     string
	Code      string
	UserAgent string
	IP        string
}

type Mail struct {
	SMTP             settingsapp.EmailLoginSettings
	Recipient        string
	AppName          string
	OrganizationName string
	Code             string
	ExpiresIn        time.Duration
	ClientLoginURL   string
	LogoURL          string
}

type Mailer interface {
	SendLoginCode(context.Context, Mail) error
	SendTestEmail(context.Context, Mail) error
}

type Dispatcher interface {
	Dispatch(string, func()) bool
}

type DispatchFunc func(string, func()) bool

func (f DispatchFunc) Dispatch(key string, task func()) bool {
	return f(key, task)
}

type SettingsProvider interface {
	Get(context.Context) (settingsapp.Settings, error)
	GetEmailLogin(context.Context) (settingsapp.EmailLoginSettings, error)
}

type ServiceAPI interface {
	RequestCode(context.Context, RequestCodeCommand) (RequestCodeResult, error)
	Login(context.Context, LoginCommand) (account.LoginResult, error)
}

type SMTPTester interface {
	TestSMTP(context.Context, string) error
}
