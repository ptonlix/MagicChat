package httpserver

import (
	"net/http"

	projectapp "app/internal/application/project"

	"github.com/labstack/echo/v4"
)

func (s *Server) mutateGroupConversationProject(c echo.Context, bind bool) error {
	user, ok := currentUser(c)
	if !ok {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	cmd := projectapp.MutateGroupCommand{
		AccountID:           user.ID,
		ProjectID:           c.Param("project_id"),
		GroupID:             c.Param("conversation_id"),
		AllowProjectMember:  true,
		RequireGroupManager: true,
	}
	var err error
	if bind {
		_, err = s.projects.BindGroup(c.Request().Context(), cmd)
	} else {
		err = s.projects.UnbindGroup(c.Request().Context(), cmd)
	}
	if err != nil {
		return writeConversationProjectApplicationError(c, err)
	}
	return success(c, http.StatusOK, map[string]any{})
}

func writeConversationProjectApplicationError(c echo.Context, err error) error {
	message := projectapp.ErrorMessage(err)
	switch projectapp.ErrorCodeOf(err) {
	case projectapp.CodeInvalidRequest:
		switch message {
		case "只能关联群聊":
			message = "只能管理群聊的关联项目"
		}
		return failure(c, http.StatusBadRequest, "invalid_request", message)
	case projectapp.CodeForbidden:
		switch message {
		case "无权访问会话":
			message = "无权访问群聊"
		case "只有群主或群管理员可以管理群聊项目":
			message = "只有群主或管理员可以管理关联项目"
		}
		return failure(c, http.StatusForbidden, "forbidden", message)
	case projectapp.CodeNotFound:
		return failure(c, http.StatusNotFound, "not_found", "群聊或项目不存在")
	case projectapp.CodeConflict:
		return failure(c, http.StatusConflict, "conflict", message)
	default:
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
}
