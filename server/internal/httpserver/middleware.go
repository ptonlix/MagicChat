package httpserver

import (
	"errors"
	"net/http"
	"time"

	"app/internal/auth"
	"app/internal/store"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

func (s *Server) requireAdminSession(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		cookie, err := c.Cookie(sessionCookieName)
		if err != nil || cookie.Value == "" {
			return failure(c, http.StatusUnauthorized, "unauthorized", "未登录")
		}

		var session store.AdminSession
		err = s.db.Where(
			"token_hash = ? AND expires_at > ?",
			auth.HashSessionToken(cookie.Value),
			time.Now().UTC(),
		).First(&session).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return failure(c, http.StatusUnauthorized, "unauthorized", "未登录")
		}
		if err != nil {
			return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
		}

		_ = s.db.Model(&session).Update("last_seen_at", time.Now().UTC()).Error
		return next(c)
	}
}

func setSessionCookie(c echo.Context, token string, expiresAt time.Time) {
	c.SetCookie(&http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}
