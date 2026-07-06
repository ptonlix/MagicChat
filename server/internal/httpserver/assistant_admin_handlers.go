package httpserver

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type llmModelRequest struct {
	DisplayName string `json:"display_name"`
	ModelName   string `json:"model_name"`
	BaseURL     string `json:"base_url"`
	APIKey      string `json:"api_key"`
}

type llmModelMoveRequest struct {
	Direction string `json:"direction"`
}

type discoverLLMModelsRequest struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
}

type llmModelResponse struct {
	ID                     string     `json:"id"`
	DisplayName            string     `json:"display_name"`
	ModelName              string     `json:"model_name"`
	BaseURL                string     `json:"base_url"`
	APIKey                 string     `json:"api_key"`
	Protocol               string     `json:"protocol"`
	Enabled                bool       `json:"enabled"`
	SortOrder              int        `json:"sort_order"`
	ConnectivityStatus     string     `json:"connectivity_status"`
	LastCheckedAt          *time.Time `json:"last_checked_at"`
	LastConnectedAt        *time.Time `json:"last_connected_at"`
	LastErrorMessage       string     `json:"last_error_message"`
	LastResponseDurationMS *int       `json:"last_response_duration_ms"`
}

type listLLMModelsResponse struct {
	Models []llmModelResponse `json:"models"`
}

type discoveredLLMModelResponse struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
}

type discoverLLMModelsResponse struct {
	Models []discoveredLLMModelResponse `json:"models"`
}

type llmModelEnvelope struct {
	Model llmModelResponse `json:"model"`
}

// listLLMModels godoc
//
// @Summary 列出大模型配置
// @Description 管理员读取 MyGod 助手的大模型配置，包含 API Key 和健康检查状态。
// @Tags 管理员 MyGod 助手
// @Produce json
// @Success 200 {object} successEnvelope{data=listLLMModelsResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/assistant/models [get]
func (s *Server) listLLMModels(c echo.Context) error {
	var models []store.LLMModel
	if err := s.db.Order("sort_order ASC").Order("display_name ASC").Order("id ASC").Find(&models).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	responses := make([]llmModelResponse, 0, len(models))
	for _, model := range models {
		responses = append(responses, newLLMModelResponse(model))
	}

	return success(c, http.StatusOK, listLLMModelsResponse{Models: responses})
}

// discoverLLMModels godoc
//
// @Summary 读取 Anthropic 大模型列表
// @Description 管理员用临时 Base URL 和 API Key 读取 Anthropic 协议的大模型列表，不会保存配置。
// @Tags 管理员 MyGod 助手
// @Accept json
// @Produce json
// @Param body body discoverLLMModelsRequest true "Anthropic 临时连接信息"
// @Success 200 {object} successEnvelope{data=discoverLLMModelsResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 502 {object} errorEnvelope
// @Router /api/admin/assistant/models/discover [post]
func (s *Server) discoverLLMModels(c echo.Context) error {
	var req discoverLLMModelsRequest
	if err := c.Bind(&req); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}

	baseURL, err := normalizeHTTPURL(req.BaseURL, "Base URL 格式错误")
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		return failure(c, http.StatusBadRequest, "invalid_request", "API Key 不能为空")
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), llmHealthCheckTimeout)
	defer cancel()

	models, err := discoverAnthropicLLMModels(ctx, http.DefaultClient, baseURL, apiKey)
	if err != nil {
		return failure(c, http.StatusBadGateway, "discover_llm_models_failed", err.Error())
	}

	return success(c, http.StatusOK, discoverLLMModelsResponse{Models: models})
}

// createLLMModel godoc
//
// @Summary 创建大模型配置
// @Description 管理员创建一个 Anthropic 协议的大模型配置。
// @Tags 管理员 MyGod 助手
// @Accept json
// @Produce json
// @Param body body llmModelRequest true "大模型配置"
// @Success 201 {object} successEnvelope{data=llmModelEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/assistant/models [post]
func (s *Server) createLLMModel(c echo.Context) error {
	var req llmModelRequest
	if err := c.Bind(&req); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}

	model, err := newLLMModelFromRequest(req)
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}
	model.ID = uuid.NewString()
	model.Enabled = true
	model.Protocol = store.LLMModelProtocolAnthropic
	model.ConnectivityStatus = store.LLMConnectivityStatusUnknown

	sortOrder, err := s.nextLLMModelSortOrder()
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	model.SortOrder = sortOrder

	if err := s.db.Create(&model).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusCreated, llmModelEnvelope{Model: newLLMModelResponse(model)})
}

// updateLLMModel godoc
//
// @Summary 更新大模型配置
// @Description 管理员更新一个大模型配置。API Key 每次更新都需要提交完整值，配置更新后健康状态会重置为未检测。
// @Tags 管理员 MyGod 助手
// @Accept json
// @Produce json
// @Param id path string true "大模型 ID"
// @Param body body llmModelRequest true "大模型配置"
// @Success 200 {object} successEnvelope{data=llmModelEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/assistant/models/{id} [put]
func (s *Server) updateLLMModel(c echo.Context) error {
	id, err := parseUUIDParam(c, "id", "大模型 ID 格式错误")
	if err != nil {
		return err
	}

	var model store.LLMModel
	err = s.db.First(&model, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "大模型不存在")
	}
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	var req llmModelRequest
	if err := c.Bind(&req); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	updatedModel, err := newLLMModelFromRequest(req)
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}

	updates := map[string]any{
		"display_name":              updatedModel.DisplayName,
		"model_name":                updatedModel.ModelName,
		"base_url":                  updatedModel.BaseURL,
		"api_key":                   updatedModel.APIKey,
		"protocol":                  store.LLMModelProtocolAnthropic,
		"connectivity_status":       store.LLMConnectivityStatusUnknown,
		"last_checked_at":           nil,
		"last_connected_at":         nil,
		"last_error_message":        "",
		"last_response_duration_ms": nil,
	}
	if err := s.db.Model(&model).Updates(updates).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if err := s.db.First(&model, "id = ?", id).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, llmModelEnvelope{Model: newLLMModelResponse(model)})
}

// enableLLMModel godoc
//
// @Summary 启用大模型配置
// @Description 管理员启用一个大模型配置。
// @Tags 管理员 MyGod 助手
// @Produce json
// @Param id path string true "大模型 ID"
// @Success 200 {object} successEnvelope{data=llmModelEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/assistant/models/{id}/enable [post]
func (s *Server) enableLLMModel(c echo.Context) error {
	return s.updateLLMModelEnabled(c, true)
}

// disableLLMModel godoc
//
// @Summary 禁用大模型配置
// @Description 管理员禁用一个大模型配置。
// @Tags 管理员 MyGod 助手
// @Produce json
// @Param id path string true "大模型 ID"
// @Success 200 {object} successEnvelope{data=llmModelEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/assistant/models/{id}/disable [post]
func (s *Server) disableLLMModel(c echo.Context) error {
	return s.updateLLMModelEnabled(c, false)
}

// moveLLMModel godoc
//
// @Summary 移动大模型配置
// @Description 管理员将一个大模型配置上移或下移，服务端会重新归一化所有配置的排序值。
// @Tags 管理员 MyGod 助手
// @Accept json
// @Produce json
// @Param id path string true "大模型 ID"
// @Param body body llmModelMoveRequest true "移动方向"
// @Success 200 {object} successEnvelope{data=listLLMModelsResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/assistant/models/{id}/move [post]
func (s *Server) moveLLMModel(c echo.Context) error {
	id, err := parseUUIDParam(c, "id", "大模型 ID 格式错误")
	if err != nil {
		return err
	}

	var req llmModelMoveRequest
	if err := c.Bind(&req); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	direction := strings.TrimSpace(req.Direction)
	if direction != "up" && direction != "down" {
		return failure(c, http.StatusBadRequest, "invalid_request", "移动方向只能是 up 或 down")
	}

	var responses []llmModelResponse
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var models []store.LLMModel
		if err := tx.Order("sort_order ASC").Order("display_name ASC").Order("id ASC").Find(&models).Error; err != nil {
			return err
		}

		index := -1
		for currentIndex, model := range models {
			if model.ID == id {
				index = currentIndex
				break
			}
		}
		if index == -1 {
			return gorm.ErrRecordNotFound
		}

		targetIndex := index
		if direction == "up" && index > 0 {
			targetIndex = index - 1
		}
		if direction == "down" && index < len(models)-1 {
			targetIndex = index + 1
		}
		models[index], models[targetIndex] = models[targetIndex], models[index]

		responses = make([]llmModelResponse, 0, len(models))
		for currentIndex := range models {
			sortOrder := (currentIndex + 1) * 10
			if err := tx.Model(&store.LLMModel{}).
				Where("id = ?", models[currentIndex].ID).
				Update("sort_order", sortOrder).Error; err != nil {
				return err
			}
			models[currentIndex].SortOrder = sortOrder
			responses = append(responses, newLLMModelResponse(models[currentIndex]))
		}

		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "大模型不存在")
	}
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, listLLMModelsResponse{Models: responses})
}

// deleteLLMModel godoc
//
// @Summary 删除大模型配置
// @Description 管理员删除一个大模型配置。
// @Tags 管理员 MyGod 助手
// @Produce json
// @Param id path string true "大模型 ID"
// @Success 200 {object} successEnvelope
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/assistant/models/{id} [delete]
func (s *Server) deleteLLMModel(c echo.Context) error {
	id, err := parseUUIDParam(c, "id", "大模型 ID 格式错误")
	if err != nil {
		return err
	}

	var model store.LLMModel
	err = s.db.First(&model, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "大模型不存在")
	}
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if err := s.db.Delete(&model).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, map[string]any{})
}

// checkLLMModelHealth godoc
//
// @Summary 主动检测大模型连接
// @Description 管理员主动发起一次 Anthropic 非流式健康检查，并返回更新后的健康状态。
// @Tags 管理员 MyGod 助手
// @Produce json
// @Param id path string true "大模型 ID"
// @Success 200 {object} successEnvelope{data=llmModelEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/assistant/models/{id}/health-check [post]
func (s *Server) checkLLMModelHealth(c echo.Context) error {
	id, err := parseUUIDParam(c, "id", "大模型 ID 格式错误")
	if err != nil {
		return err
	}

	model, err := s.llmHealthChecker.CheckModelByID(c.Request().Context(), id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "大模型不存在")
	}
	if errors.Is(err, errLLMHealthCheckRunning) {
		return failure(c, http.StatusConflict, "health_check_running", "大模型正在检测中")
	}
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, llmModelEnvelope{Model: newLLMModelResponse(model)})
}

func (s *Server) updateLLMModelEnabled(c echo.Context, enabled bool) error {
	id, err := parseUUIDParam(c, "id", "大模型 ID 格式错误")
	if err != nil {
		return err
	}

	var model store.LLMModel
	err = s.db.First(&model, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "大模型不存在")
	}
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if err := s.db.Model(&model).Update("enabled", enabled).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	model.Enabled = enabled

	return success(c, http.StatusOK, llmModelEnvelope{Model: newLLMModelResponse(model)})
}

func discoverAnthropicLLMModels(ctx context.Context, client *http.Client, baseURL string, apiKey string) ([]discoveredLLMModelResponse, error) {
	modelsURL, err := anthropicModelsURL(baseURL)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", anthropicVersion)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("anthropic model discovery failed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
	}

	var decoded struct {
		Data []struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("decode anthropic models response: %w", err)
	}

	models := make([]discoveredLLMModelResponse, 0, len(decoded.Data))
	for _, model := range decoded.Data {
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		models = append(models, discoveredLLMModelResponse{
			ID:          id,
			DisplayName: strings.TrimSpace(model.DisplayName),
		})
	}

	return models, nil
}

func newLLMModelFromRequest(req llmModelRequest) (store.LLMModel, error) {
	modelName := strings.TrimSpace(req.ModelName)
	if modelName == "" {
		return store.LLMModel{}, errors.New("模型名称不能为空")
	}
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = modelName
	}
	baseURL, err := normalizeHTTPURL(req.BaseURL, "Base URL 格式错误")
	if err != nil {
		return store.LLMModel{}, err
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		return store.LLMModel{}, errors.New("API Key 不能为空")
	}

	return store.LLMModel{
		DisplayName: displayName,
		ModelName:   modelName,
		BaseURL:     baseURL,
		APIKey:      apiKey,
	}, nil
}

func newLLMModelResponse(model store.LLMModel) llmModelResponse {
	return llmModelResponse{
		ID:                     model.ID,
		DisplayName:            model.DisplayName,
		ModelName:              model.ModelName,
		BaseURL:                model.BaseURL,
		APIKey:                 model.APIKey,
		Protocol:               model.Protocol,
		Enabled:                model.Enabled,
		SortOrder:              model.SortOrder,
		ConnectivityStatus:     model.ConnectivityStatus,
		LastCheckedAt:          model.LastCheckedAt,
		LastConnectedAt:        model.LastConnectedAt,
		LastErrorMessage:       model.LastErrorMessage,
		LastResponseDurationMS: model.LastResponseDurationMS,
	}
}

func (s *Server) nextLLMModelSortOrder() (int, error) {
	var maxSortOrder sql.NullInt64
	if err := s.db.Model(&store.LLMModel{}).Select("MAX(sort_order)").Scan(&maxSortOrder).Error; err != nil {
		return 0, err
	}
	if !maxSortOrder.Valid {
		return 10, nil
	}

	return int(maxSortOrder.Int64) + 10, nil
}
