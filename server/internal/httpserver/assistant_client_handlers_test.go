package httpserver

import (
	"net/http"
	"testing"
	"time"

	"app/internal/store"
)

func TestClientCanListEnabledLLMModels(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	now := time.Now().UTC()
	user := insertTestUser(t, db, "alice@example.com", "Alice", store.UserStatusActive, now)
	durationMS := 1340
	connected := insertTestLLMModel(t, db, store.LLMModel{
		DisplayName:            "Claude Sonnet",
		ModelName:              "claude-sonnet",
		BaseURL:                "https://anthropic.example.com",
		APIKey:                 "sk-ant-connected",
		Enabled:                true,
		SortOrder:              20,
		ConnectivityStatus:     store.LLMConnectivityStatusConnected,
		LastResponseDurationMS: &durationMS,
	})
	failed := insertTestLLMModel(t, db, store.LLMModel{
		DisplayName:        "Claude Haiku",
		ModelName:          "claude-haiku",
		BaseURL:            "https://anthropic.example.com",
		APIKey:             "sk-ant-failed",
		Enabled:            true,
		SortOrder:          10,
		ConnectivityStatus: store.LLMConnectivityStatusFailed,
	})
	disabled := insertTestLLMModel(t, db, store.LLMModel{
		DisplayName:            "Disabled Claude",
		ModelName:              "claude-disabled",
		BaseURL:                "https://anthropic.example.com",
		APIKey:                 "sk-ant-disabled",
		Enabled:                true,
		SortOrder:              5,
		ConnectivityStatus:     store.LLMConnectivityStatusConnected,
		LastResponseDurationMS: &durationMS,
	})
	if err := db.Model(&store.LLMModel{}).Where("id = ?", disabled.ID).Update("enabled", false).Error; err != nil {
		t.Fatalf("disable test llm model: %v", err)
	}

	userCookie := loginAsUser(t, server, user.Email)
	resp, body := getJSON(t, server, "/api/client/assistant/models", userCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list client llm models status = %d, want 200, body = %#v", resp.StatusCode, body)
	}

	models := requireClientLLMModels(t, requireSuccess(t, body))
	if len(models) != 2 {
		t.Fatalf("client llm model count = %d, want 2", len(models))
	}

	firstModel := models[0].(map[string]any)
	if firstModel["id"] != failed.ID {
		t.Fatalf("first model id = %#v, want failed model by sort order", firstModel["id"])
	}
	if firstModel["display_name"] != "Claude Haiku" {
		t.Fatalf("first display_name = %#v, want Claude Haiku", firstModel["display_name"])
	}
	if firstModel["connectivity_status"] != store.LLMConnectivityStatusFailed {
		t.Fatalf("first connectivity_status = %#v, want failed", firstModel["connectivity_status"])
	}
	if firstModel["last_response_duration_ms"] != nil {
		t.Fatalf("first last_response_duration_ms = %#v, want nil", firstModel["last_response_duration_ms"])
	}

	secondModel := models[1].(map[string]any)
	if secondModel["id"] != connected.ID {
		t.Fatalf("second model id = %#v, want connected model", secondModel["id"])
	}
	if secondModel["display_name"] != "Claude Sonnet" {
		t.Fatalf("second display_name = %#v, want Claude Sonnet", secondModel["display_name"])
	}
	if secondModel["connectivity_status"] != store.LLMConnectivityStatusConnected {
		t.Fatalf("second connectivity_status = %#v, want connected", secondModel["connectivity_status"])
	}
	if secondModel["last_response_duration_ms"] != float64(1340) {
		t.Fatalf("second last_response_duration_ms = %#v, want 1340", secondModel["last_response_duration_ms"])
	}
	for _, forbidden := range []string{"api_key", "base_url", "model_name", "last_error_message"} {
		if _, ok := firstModel[forbidden]; ok {
			t.Fatalf("client model contains %q: %#v", forbidden, firstModel)
		}
		if _, ok := secondModel[forbidden]; ok {
			t.Fatalf("client model contains %q: %#v", forbidden, secondModel)
		}
	}
}

func TestClientLLMModelListRequiresUserSession(t *testing.T) {
	server, _ := newTestRouter(t)
	defer server.Close()

	resp, body := getJSON(t, server, "/api/client/assistant/models")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("list client llm models status = %d, want 401", resp.StatusCode)
	}
	requireError(t, body, "unauthorized")
}

func requireClientLLMModels(t *testing.T, data map[string]any) []any {
	t.Helper()

	models, ok := data["models"].([]any)
	if !ok {
		t.Fatalf("models = %#v, want array", data["models"])
	}

	return models
}
