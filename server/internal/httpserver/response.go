package httpserver

import "github.com/labstack/echo/v4"

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type successEnvelope struct {
	Success bool `json:"success" example:"true"`
	Data    any  `json:"data"`
}

type errorEnvelope struct {
	Success bool      `json:"success" example:"false"`
	Error   errorBody `json:"error"`
}

func success(c echo.Context, status int, data any) error {
	return c.JSON(status, successEnvelope{
		Success: true,
		Data:    data,
	})
}

func failure(c echo.Context, status int, code string, message string) error {
	return c.JSON(status, errorEnvelope{
		Success: false,
		Error: errorBody{
			Code:    code,
			Message: message,
		},
	})
}
