package httpserver

import (
	"net/http"

	"app/internal/store"

	"github.com/labstack/echo/v4"
)

type clientLLMModelResponse struct {
	ID                     string `json:"id"`
	DisplayName            string `json:"display_name"`
	ConnectivityStatus     string `json:"connectivity_status"`
	LastResponseDurationMS *int   `json:"last_response_duration_ms"`
}

type listClientLLMModelsResponse struct {
	Models []clientLLMModelResponse `json:"models"`
}

// listClientLLMModels godoc
//
// @Summary 列出客户端可用大模型
// @Description 普通用户读取可用的大模型列表，只返回展示和健康检查状态，不暴露模型调用配置。
// @Tags 客户端 MyGod 助手
// @Produce json
// @Success 200 {object} successEnvelope{data=listClientLLMModelsResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/assistant/models [get]
func (s *Server) listClientLLMModels(c echo.Context) error {
	var models []store.LLMModel
	if err := s.db.
		Where("enabled = ?", true).
		Order("sort_order ASC").
		Order("display_name ASC").
		Order("id ASC").
		Find(&models).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	responses := make([]clientLLMModelResponse, 0, len(models))
	for _, model := range models {
		responses = append(responses, newClientLLMModelResponse(model))
	}

	return success(c, http.StatusOK, listClientLLMModelsResponse{Models: responses})
}

func newClientLLMModelResponse(model store.LLMModel) clientLLMModelResponse {
	return clientLLMModelResponse{
		ID:                     model.ID,
		DisplayName:            model.DisplayName,
		ConnectivityStatus:     model.ConnectivityStatus,
		LastResponseDurationMS: model.LastResponseDurationMS,
	}
}
