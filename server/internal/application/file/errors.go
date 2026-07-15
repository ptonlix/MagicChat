package file

import "errors"

type ErrorCode string

const (
	CodeInvalidRequest     ErrorCode = "invalid_request"
	CodeRequestTooLarge    ErrorCode = "request_too_large"
	CodeNotFound           ErrorCode = "not_found"
	CodeStorageUnavailable ErrorCode = "storage_unavailable"
	CodeInternal           ErrorCode = "internal_error"
)

type Error struct {
	Code    ErrorCode
	Message string
	Cause   error
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
	var fileErr *Error
	if errors.As(err, &fileErr) {
		return fileErr.Code
	}
	return CodeInternal
}

func ErrorMessage(err error) string {
	var fileErr *Error
	if errors.As(err, &fileErr) && fileErr.Message != "" {
		return fileErr.Message
	}
	return "服务端错误"
}

func newError(code ErrorCode, message string, cause error) error {
	return &Error{Code: code, Message: message, Cause: cause}
}
