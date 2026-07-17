package emailauth

import "errors"

type ErrorCode string

const (
	CodeInvalidRequest  ErrorCode = "invalid_request"
	CodeInvalidCode     ErrorCode = "invalid_code"
	CodeTooManyRequests ErrorCode = "too_many_requests"
	CodeUnavailable     ErrorCode = "email_login_unavailable"
	CodeInternal        ErrorCode = "internal_error"
)

type Error struct {
	Code       ErrorCode
	Message    string
	RetryAfter int
	Cause      error
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func ErrorCodeOf(err error) ErrorCode {
	var value *Error
	if errors.As(err, &value) {
		return value.Code
	}
	return CodeInternal
}

func ErrorMessage(err error) string {
	var value *Error
	if errors.As(err, &value) && value.Message != "" {
		return value.Message
	}
	return "服务端错误"
}

func RetryAfterOf(err error) int {
	var value *Error
	if errors.As(err, &value) {
		return value.RetryAfter
	}
	return 0
}

func newError(code ErrorCode, message string, cause error) error {
	return &Error{Code: code, Message: message, Cause: cause}
}

func rateLimited(retryAfter int) error {
	return &Error{Code: CodeTooManyRequests, Message: "请求过于频繁，请稍后重试", RetryAfter: retryAfter}
}
