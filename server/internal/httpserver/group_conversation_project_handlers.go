package httpserver

import (
	"context"

	"github.com/labstack/echo/v4"
)

type conversationProjectResponse struct {
	Avatar      string `json:"avatar"`
	Description string `json:"description"`
	ID          string `json:"id"`
	Name        string `json:"name"`
}

func (s *Server) loadConversationProjects(ctx context.Context, conversationIDs []string) (map[string][]conversationProjectResponse, error) {
	values, err := s.projects.ListForConversations(ctx, conversationIDs)
	if err != nil {
		return nil, err
	}
	projects := make(map[string][]conversationProjectResponse, len(values))
	for conversationID, items := range values {
		projects[conversationID] = make([]conversationProjectResponse, 0, len(items))
		for _, item := range items {
			projects[conversationID] = append(projects[conversationID], conversationProjectResponse{
				Avatar: item.Avatar, Description: item.Description, ID: item.ID, Name: item.Name,
			})
		}
	}
	return projects, nil
}

// bindGroupConversationProject godoc
//
// @Summary 关联群聊项目
// @Description 群主或群管理员将当前群聊关联到一个可访问的协作项目；重复关联保持成功。
// @Tags 客户端会话
// @Produce json
// @Param conversation_id path string true "群聊 ID"
// @Param project_id path string true "项目 ID"
// @Success 200 {object} successEnvelope{data=projectGroupMutationResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/conversations/{conversation_id}/projects/{project_id} [put]
func (s *Server) bindGroupConversationProject(c echo.Context) error {
	return s.mutateGroupConversationProject(c, true)
}

// unbindGroupConversationProject godoc
//
// @Summary 解除群聊项目关联
// @Description 群主或群管理员解除当前群聊与协作项目的关联；未关联时保持成功。
// @Tags 客户端会话
// @Produce json
// @Param conversation_id path string true "群聊 ID"
// @Param project_id path string true "项目 ID"
// @Success 200 {object} successEnvelope{data=projectGroupMutationResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/conversations/{conversation_id}/projects/{project_id} [delete]
func (s *Server) unbindGroupConversationProject(c echo.Context) error {
	return s.mutateGroupConversationProject(c, false)
}
