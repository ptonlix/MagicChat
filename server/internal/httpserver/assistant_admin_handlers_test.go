package httpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestAdminCanManageLLMModels(t *testing.T) {
	server, _ := newTestRouter(t)
	defer server.Close()
	adminCookie := loginAsAdmin(t, server)

	createResp, createBody := postJSON(t, server, "/api/admin/assistant/models", map[string]any{
		"display_name": "",
		"model_name":   "claude-3-5-sonnet-latest",
		"base_url":     "https://api.anthropic.com",
		"api_key":      "sk-ant-test",
	}, adminCookie)
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d, want 201, body = %#v", createResp.StatusCode, createBody)
	}
	createdModel := requireSuccess(t, createBody)["model"].(map[string]any)
	modelID, ok := createdModel["id"].(string)
	if !ok || modelID == "" {
		t.Fatalf("created model id = %#v, want string", createdModel["id"])
	}
	if createdModel["display_name"] != "claude-3-5-sonnet-latest" {
		t.Fatalf("created display_name = %#v, want model name fallback", createdModel["display_name"])
	}
	if createdModel["model_name"] != "claude-3-5-sonnet-latest" {
		t.Fatalf("created model_name = %#v, want claude-3-5-sonnet-latest", createdModel["model_name"])
	}
	if createdModel["base_url"] != "https://api.anthropic.com" {
		t.Fatalf("created base_url = %#v, want https://api.anthropic.com", createdModel["base_url"])
	}
	if createdModel["api_key"] != "sk-ant-test" {
		t.Fatalf("created api_key = %#v, want sk-ant-test", createdModel["api_key"])
	}
	if createdModel["protocol"] != "anthropic" {
		t.Fatalf("created protocol = %#v, want anthropic", createdModel["protocol"])
	}
	if createdModel["enabled"] != true {
		t.Fatalf("created enabled = %#v, want true", createdModel["enabled"])
	}
	if createdModel["sort_order"] != float64(10) {
		t.Fatalf("created sort_order = %#v, want 10", createdModel["sort_order"])
	}
	if createdModel["connectivity_status"] != "unknown" {
		t.Fatalf("created connectivity_status = %#v, want unknown", createdModel["connectivity_status"])
	}
	if createdModel["last_checked_at"] != nil {
		t.Fatalf("created last_checked_at = %#v, want nil", createdModel["last_checked_at"])
	}
	if createdModel["last_connected_at"] != nil {
		t.Fatalf("created last_connected_at = %#v, want nil", createdModel["last_connected_at"])
	}
	if createdModel["last_error_message"] != "" {
		t.Fatalf("created last_error_message = %#v, want empty", createdModel["last_error_message"])
	}
	if createdModel["last_response_duration_ms"] != nil {
		t.Fatalf("created last_response_duration_ms = %#v, want nil", createdModel["last_response_duration_ms"])
	}

	listResp, listBody := getJSON(t, server, "/api/admin/assistant/models", adminCookie)
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, want 200", listResp.StatusCode)
	}
	models := requireLLMModels(t, requireSuccess(t, listBody))
	if len(models) != 1 {
		t.Fatalf("model count = %d, want 1", len(models))
	}
	listedModel := models[0].(map[string]any)
	if listedModel["api_key"] != "sk-ant-test" {
		t.Fatalf("listed api_key = %#v, want sk-ant-test", listedModel["api_key"])
	}

	updateResp, updateBody := putJSON(t, server, "/api/admin/assistant/models/"+modelID, map[string]any{
		"display_name": "Claude Haiku",
		"model_name":   "claude-3-5-haiku-latest",
		"base_url":     "https://anthropic.example.com/v1",
		"api_key":      "sk-ant-updated",
	}, adminCookie)
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("update status = %d, want 200, body = %#v", updateResp.StatusCode, updateBody)
	}
	updatedModel := requireSuccess(t, updateBody)["model"].(map[string]any)
	if updatedModel["display_name"] != "Claude Haiku" {
		t.Fatalf("updated display_name = %#v, want Claude Haiku", updatedModel["display_name"])
	}
	if updatedModel["api_key"] != "sk-ant-updated" {
		t.Fatalf("updated api_key = %#v, want sk-ant-updated", updatedModel["api_key"])
	}
	if updatedModel["enabled"] != true {
		t.Fatalf("updated enabled = %#v, want preserved true", updatedModel["enabled"])
	}
	if updatedModel["sort_order"] != float64(10) {
		t.Fatalf("updated sort_order = %#v, want preserved 10", updatedModel["sort_order"])
	}
	if updatedModel["connectivity_status"] != "unknown" {
		t.Fatalf("updated connectivity_status = %#v, want unknown", updatedModel["connectivity_status"])
	}

	disableResp, disableBody := postJSON(t, server, "/api/admin/assistant/models/"+modelID+"/disable", map[string]any{}, adminCookie)
	if disableResp.StatusCode != http.StatusOK {
		t.Fatalf("disable status = %d, want 200, body = %#v", disableResp.StatusCode, disableBody)
	}
	disabledModel := requireSuccess(t, disableBody)["model"].(map[string]any)
	if disabledModel["enabled"] != false {
		t.Fatalf("disabled enabled = %#v, want false", disabledModel["enabled"])
	}

	deleteResp, deleteBody := requestJSON(t, server, http.MethodDelete, "/api/admin/assistant/models/"+modelID, map[string]any{}, adminCookie)
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("delete status = %d, want 200, body = %#v", deleteResp.StatusCode, deleteBody)
	}
	requireSuccess(t, deleteBody)

	finalListResp, finalListBody := getJSON(t, server, "/api/admin/assistant/models", adminCookie)
	if finalListResp.StatusCode != http.StatusOK {
		t.Fatalf("final list status = %d, want 200", finalListResp.StatusCode)
	}
	finalModels := requireLLMModels(t, requireSuccess(t, finalListBody))
	if len(finalModels) != 0 {
		t.Fatalf("final model count = %d, want 0", len(finalModels))
	}
}

func TestAdminCanDiscoverAnthropicLLMModels(t *testing.T) {
	var receivedPath string
	var receivedAPIKey string
	var receivedVersion string
	anthropicServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		receivedAPIKey = r.Header.Get("x-api-key")
		receivedVersion = r.Header.Get("anthropic-version")

		if r.Method != http.MethodGet {
			t.Fatalf("anthropic method = %q, want GET", r.Method)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data": [
				{"id": "claude-3-5-sonnet-latest", "display_name": "Claude 3.5 Sonnet"},
				{"id": "claude-3-haiku-20240307"}
			]
		}`))
	}))
	defer anthropicServer.Close()

	server, _ := newTestRouter(t)
	defer server.Close()
	adminCookie := loginAsAdmin(t, server)

	resp, body := postJSON(t, server, "/api/admin/assistant/models/discover", map[string]any{
		"base_url": anthropicServer.URL + "/v1",
		"api_key":  "sk-ant-discover",
	}, adminCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("discover status = %d, want 200, body = %#v", resp.StatusCode, body)
	}
	data := requireSuccess(t, body)
	models, ok := data["models"].([]any)
	if !ok {
		t.Fatalf("models = %#v, want array", data["models"])
	}
	if len(models) != 2 {
		t.Fatalf("model count = %d, want 2", len(models))
	}
	firstModel := models[0].(map[string]any)
	if firstModel["id"] != "claude-3-5-sonnet-latest" {
		t.Fatalf("first id = %#v, want claude-3-5-sonnet-latest", firstModel["id"])
	}
	if firstModel["display_name"] != "Claude 3.5 Sonnet" {
		t.Fatalf("first display_name = %#v, want Claude 3.5 Sonnet", firstModel["display_name"])
	}
	secondModel := models[1].(map[string]any)
	if secondModel["id"] != "claude-3-haiku-20240307" {
		t.Fatalf("second id = %#v, want claude-3-haiku-20240307", secondModel["id"])
	}
	if secondModel["display_name"] != "" {
		t.Fatalf("second display_name = %#v, want empty", secondModel["display_name"])
	}
	if receivedPath != "/v1/models" {
		t.Fatalf("anthropic path = %q, want /v1/models", receivedPath)
	}
	if receivedAPIKey != "sk-ant-discover" {
		t.Fatalf("x-api-key = %q, want sk-ant-discover", receivedAPIKey)
	}
	if receivedVersion != "2023-06-01" {
		t.Fatalf("anthropic-version = %q, want 2023-06-01", receivedVersion)
	}

	listResp, listBody := getJSON(t, server, "/api/admin/assistant/models", adminCookie)
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, want 200", listResp.StatusCode)
	}
	if models := requireLLMModels(t, requireSuccess(t, listBody)); len(models) != 0 {
		t.Fatalf("stored model count = %d, want 0", len(models))
	}
}

func TestAdminMovesLLMModelsAndNormalizesSortOrder(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	adminCookie := loginAsAdmin(t, server)

	first := insertTestLLMModel(t, db, store.LLMModel{
		DisplayName: "Alpha",
		ModelName:   "claude-alpha",
		BaseURL:     "https://alpha.example.com",
		APIKey:      "alpha-key",
		Enabled:     true,
		SortOrder:   5,
	})
	second := insertTestLLMModel(t, db, store.LLMModel{
		DisplayName: "Beta",
		ModelName:   "claude-beta",
		BaseURL:     "https://beta.example.com",
		APIKey:      "beta-key",
		Enabled:     true,
		SortOrder:   5,
	})
	third := insertTestLLMModel(t, db, store.LLMModel{
		DisplayName: "Gamma",
		ModelName:   "claude-gamma",
		BaseURL:     "https://gamma.example.com",
		APIKey:      "gamma-key",
		Enabled:     true,
		SortOrder:   5,
	})

	moveResp, moveBody := postJSON(t, server, "/api/admin/assistant/models/"+third.ID+"/move", map[string]any{
		"direction": "up",
	}, adminCookie)
	if moveResp.StatusCode != http.StatusOK {
		t.Fatalf("move status = %d, want 200, body = %#v", moveResp.StatusCode, moveBody)
	}

	models := requireLLMModels(t, requireSuccess(t, moveBody))
	if got := []string{
		models[0].(map[string]any)["id"].(string),
		models[1].(map[string]any)["id"].(string),
		models[2].(map[string]any)["id"].(string),
	}; got[0] != first.ID || got[1] != third.ID || got[2] != second.ID {
		t.Fatalf("model order = %#v, want first, third, second", got)
	}
	for index, model := range models {
		wantSortOrder := float64((index + 1) * 10)
		if model.(map[string]any)["sort_order"] != wantSortOrder {
			t.Fatalf("model %d sort_order = %#v, want %v", index, model.(map[string]any)["sort_order"], wantSortOrder)
		}
	}
}

func TestAdminCanRunLLMModelHealthCheck(t *testing.T) {
	var receivedPath string
	var receivedAPIKey string
	var receivedVersion string
	var receivedRequest map[string]any
	anthropicServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		receivedAPIKey = r.Header.Get("x-api-key")
		receivedVersion = r.Header.Get("anthropic-version")
		if err := json.NewDecoder(r.Body).Decode(&receivedRequest); err != nil {
			t.Fatalf("decode anthropic request: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_test",
			"type": "message",
			"role": "assistant",
			"content": [{"type": "text", "text": "pong"}],
			"model": "claude-test",
			"stop_reason": "end_turn",
			"usage": {"input_tokens": 1, "output_tokens": 1}
		}`))
	}))
	defer anthropicServer.Close()

	server, db := newTestRouter(t)
	defer server.Close()
	adminCookie := loginAsAdmin(t, server)
	model := insertTestLLMModel(t, db, store.LLMModel{
		DisplayName: "Claude Test",
		ModelName:   "claude-test",
		BaseURL:     anthropicServer.URL + "/v1",
		APIKey:      "sk-ant-health",
		Enabled:     true,
		SortOrder:   10,
	})

	checkResp, checkBody := postJSON(t, server, "/api/admin/assistant/models/"+model.ID+"/health-check", map[string]any{}, adminCookie)
	if checkResp.StatusCode != http.StatusOK {
		t.Fatalf("health check status = %d, want 200, body = %#v", checkResp.StatusCode, checkBody)
	}
	checkedModel := requireSuccess(t, checkBody)["model"].(map[string]any)
	if checkedModel["connectivity_status"] != "connected" {
		t.Fatalf("connectivity_status = %#v, want connected", checkedModel["connectivity_status"])
	}
	if checkedModel["last_checked_at"] == nil {
		t.Fatalf("last_checked_at = %#v, want timestamp", checkedModel["last_checked_at"])
	}
	if checkedModel["last_connected_at"] == nil {
		t.Fatalf("last_connected_at = %#v, want timestamp", checkedModel["last_connected_at"])
	}
	if checkedModel["last_error_message"] != "" {
		t.Fatalf("last_error_message = %#v, want empty", checkedModel["last_error_message"])
	}
	responseDuration, ok := checkedModel["last_response_duration_ms"].(float64)
	if !ok || responseDuration <= 0 {
		t.Fatalf("last_response_duration_ms = %#v, want positive number", checkedModel["last_response_duration_ms"])
	}
	if receivedPath != "/v1/messages" {
		t.Fatalf("anthropic path = %q, want /v1/messages", receivedPath)
	}
	if receivedAPIKey != "sk-ant-health" {
		t.Fatalf("x-api-key = %q, want sk-ant-health", receivedAPIKey)
	}
	if receivedVersion != "2023-06-01" {
		t.Fatalf("anthropic-version = %q, want 2023-06-01", receivedVersion)
	}
	if receivedRequest["model"] != "claude-test" {
		t.Fatalf("request model = %#v, want claude-test", receivedRequest["model"])
	}
	if receivedRequest["max_tokens"] != float64(64) {
		t.Fatalf("request max_tokens = %#v, want 64", receivedRequest["max_tokens"])
	}
	if _, ok := receivedRequest["stream"]; ok {
		t.Fatalf("request stream = %#v, want omitted", receivedRequest["stream"])
	}
}

func TestAdminLLMModelHealthCheckRecordsFailure(t *testing.T) {
	anthropicServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"invalid api key"}}`, http.StatusUnauthorized)
	}))
	defer anthropicServer.Close()

	server, db := newTestRouter(t)
	defer server.Close()
	adminCookie := loginAsAdmin(t, server)
	model := insertTestLLMModel(t, db, store.LLMModel{
		DisplayName: "Broken Claude",
		ModelName:   "claude-broken",
		BaseURL:     anthropicServer.URL,
		APIKey:      "bad-key",
		Enabled:     true,
		SortOrder:   10,
	})

	checkResp, checkBody := postJSON(t, server, "/api/admin/assistant/models/"+model.ID+"/health-check", map[string]any{}, adminCookie)
	if checkResp.StatusCode != http.StatusOK {
		t.Fatalf("health check status = %d, want 200, body = %#v", checkResp.StatusCode, checkBody)
	}
	checkedModel := requireSuccess(t, checkBody)["model"].(map[string]any)
	if checkedModel["connectivity_status"] != "failed" {
		t.Fatalf("connectivity_status = %#v, want failed", checkedModel["connectivity_status"])
	}
	if checkedModel["last_checked_at"] == nil {
		t.Fatalf("last_checked_at = %#v, want timestamp", checkedModel["last_checked_at"])
	}
	if checkedModel["last_connected_at"] != nil {
		t.Fatalf("last_connected_at = %#v, want nil", checkedModel["last_connected_at"])
	}
	errorMessage, ok := checkedModel["last_error_message"].(string)
	if !ok || !strings.Contains(errorMessage, "401") {
		t.Fatalf("last_error_message = %#v, want status code", checkedModel["last_error_message"])
	}
	if checkedModel["last_response_duration_ms"] != nil {
		t.Fatalf("last_response_duration_ms = %#v, want nil on failure", checkedModel["last_response_duration_ms"])
	}
}

func TestLLMModelAdminAPIRequiresAdminSession(t *testing.T) {
	server, _ := newTestRouter(t)
	defer server.Close()

	resp, body := getJSON(t, server, "/api/admin/assistant/models")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
	requireError(t, body, "unauthorized")

	resp, body = postJSON(t, server, "/api/admin/assistant/models/discover", map[string]any{
		"base_url": "https://api.anthropic.com",
		"api_key":  "sk-ant-test",
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("discover status = %d, want 401", resp.StatusCode)
	}
	requireError(t, body, "unauthorized")
}

func insertTestLLMModel(t *testing.T, db *gorm.DB, input store.LLMModel) store.LLMModel {
	t.Helper()

	if input.ID == "" {
		input.ID = uuid.NewString()
	}
	if input.Protocol == "" {
		input.Protocol = store.LLMModelProtocolAnthropic
	}
	if input.ConnectivityStatus == "" {
		input.ConnectivityStatus = store.LLMConnectivityStatusUnknown
	}
	now := time.Now().UTC()
	if input.CreatedAt.IsZero() {
		input.CreatedAt = now
	}
	if input.UpdatedAt.IsZero() {
		input.UpdatedAt = now
	}
	if err := db.Create(&input).Error; err != nil {
		t.Fatalf("create test llm model: %v", err)
	}

	return input
}

func requireLLMModels(t *testing.T, data map[string]any) []any {
	t.Helper()

	models, ok := data["models"].([]any)
	if !ok {
		t.Fatalf("models = %#v, want array", data["models"])
	}

	return models
}
