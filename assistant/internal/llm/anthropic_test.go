package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"assistant/internal/config"
)

func TestAnthropicClientGenerateUsesMessagesAPI(t *testing.T) {
	var gotPath string
	var gotAPIKey string
	var gotVersion string
	var gotModel string
	var gotMaxTokens int
	var gotSystem string
	var gotRole string
	var gotContent string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAPIKey = r.Header.Get("x-api-key")
		gotVersion = r.Header.Get("anthropic-version")

		var request struct {
			Model     string `json:"model"`
			MaxTokens int    `json:"max_tokens"`
			System    []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"system"`
			Messages []struct {
				Role    string `json:"role"`
				Content []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		gotModel = request.Model
		gotMaxTokens = request.MaxTokens
		if len(request.System) == 1 {
			gotSystem = request.System[0].Text
		}
		if len(request.Messages) == 1 {
			gotRole = request.Messages[0].Role
			if len(request.Messages[0].Content) == 1 {
				gotContent = request.Messages[0].Content[0].Text
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_test",
			"model": "claude-sonnet",
			"role": "assistant",
			"stop_reason": "end_turn",
			"stop_sequence": null,
			"type": "message",
			"usage": {"input_tokens": 10, "output_tokens": 5},
			"content": [
				{"type": "text", "text": "你好，我是模型回复"}
			]
		}`))
	}))
	defer server.Close()

	client := NewAnthropicClient(config.LLMConfig{
		BaseURL:   server.URL,
		APIKey:    "test-api-key",
		ModelName: "claude-sonnet",
	})
	client.HTTPClient = server.Client()

	reply, err := client.Generate(context.Background(), Request{
		System: "你是 MyGod 助手",
		Messages: []Message{
			{
				Role:    "user",
				Content: "你好",
			},
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if gotPath != "/v1/messages" {
		t.Fatalf("path = %q, want /v1/messages", gotPath)
	}
	if gotAPIKey != "test-api-key" {
		t.Fatalf("x-api-key = %q, want test-api-key", gotAPIKey)
	}
	if gotVersion != AnthropicVersion {
		t.Fatalf("anthropic-version = %q, want %s", gotVersion, AnthropicVersion)
	}
	if gotModel != "claude-sonnet" {
		t.Fatalf("model = %q, want claude-sonnet", gotModel)
	}
	if gotMaxTokens != DefaultMaxTokens {
		t.Fatalf("max_tokens = %d, want %d", gotMaxTokens, DefaultMaxTokens)
	}
	if gotSystem != "你是 MyGod 助手" {
		t.Fatalf("system = %q, want system prompt", gotSystem)
	}
	if gotRole != "user" {
		t.Fatalf("role = %q, want user", gotRole)
	}
	if gotContent != "你好" {
		t.Fatalf("content = %q, want 你好", gotContent)
	}
	if reply != "你好，我是模型回复" {
		t.Fatalf("reply = %q, want model text", reply)
	}
}

func TestAnthropicClientDoesNotDuplicateV1Path(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_test",
			"model": "claude-sonnet",
			"role": "assistant",
			"stop_reason": "end_turn",
			"stop_sequence": null,
			"type": "message",
			"usage": {"input_tokens": 1, "output_tokens": 1},
			"content":[{"type":"text","text":"ok"}]
		}`))
	}))
	defer server.Close()

	client := NewAnthropicClient(config.LLMConfig{
		BaseURL:   server.URL + "/v1",
		APIKey:    "test-api-key",
		ModelName: "claude-sonnet",
	})
	client.HTTPClient = server.Client()

	if _, err := client.Generate(context.Background(), Request{
		Messages: []Message{{Role: "user", Content: "ping"}},
	}); err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if gotPath != "/v1/messages" {
		t.Fatalf("path = %q, want /v1/messages", gotPath)
	}
}
