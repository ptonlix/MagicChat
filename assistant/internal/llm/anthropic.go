package llm

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"assistant/internal/config"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

const (
	AnthropicVersion = "2023-06-01"
	DefaultMaxTokens = 1024
)

type Model interface {
	Generate(ctx context.Context, request Request) (string, error)
}

type Request struct {
	System   string    `json:"system,omitempty"`
	Messages []Message `json:"messages"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type AnthropicClient struct {
	BaseURL    string
	APIKey     string
	ModelName  string
	MaxTokens  int
	HTTPClient *http.Client
}

func NewAnthropicClient(cfg config.LLMConfig) *AnthropicClient {
	return &AnthropicClient{
		BaseURL:   normalizeSDKBaseURL(cfg.BaseURL),
		APIKey:    strings.TrimSpace(cfg.APIKey),
		ModelName: strings.TrimSpace(cfg.ModelName),
		MaxTokens: DefaultMaxTokens,
		HTTPClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (c *AnthropicClient) Generate(ctx context.Context, request Request) (string, error) {
	if strings.TrimSpace(c.BaseURL) == "" || strings.TrimSpace(c.APIKey) == "" || strings.TrimSpace(c.ModelName) == "" {
		return "", fmt.Errorf("llm.base_url, llm.api_key, and llm.model_name are required")
	}
	if len(request.Messages) == 0 {
		return "", fmt.Errorf("llm request messages are required")
	}

	params := anthropic.MessageNewParams{
		MaxTokens: int64(c.maxTokens()),
		Model:     anthropic.Model(c.ModelName),
		Messages:  make([]anthropic.MessageParam, 0, len(request.Messages)),
	}
	if system := strings.TrimSpace(request.System); system != "" {
		params.System = []anthropic.TextBlockParam{{Text: system}}
	}
	for _, message := range request.Messages {
		block := anthropic.NewTextBlock(message.Content)
		switch message.Role {
		case "assistant":
			params.Messages = append(params.Messages, anthropic.NewAssistantMessage(block))
		default:
			params.Messages = append(params.Messages, anthropic.NewUserMessage(block))
		}
	}

	client := c.sdkClient()
	response, err := client.Messages.New(ctx, params)
	if err != nil {
		return "", err
	}

	var parts []string
	for _, block := range response.Content {
		if block.Type == "text" && strings.TrimSpace(block.Text) != "" {
			parts = append(parts, block.Text)
		}
	}
	if len(parts) == 0 {
		return "", fmt.Errorf("anthropic messages response contains no text content")
	}

	return strings.TrimSpace(strings.Join(parts, "\n")), nil
}

func (c *AnthropicClient) sdkClient() anthropic.Client {
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}

	return anthropic.NewClient(
		option.WithAPIKey(c.APIKey),
		option.WithBaseURL(c.BaseURL),
		option.WithHTTPClient(httpClient),
		option.WithRequestTimeout(60*time.Second),
	)
}

func (c *AnthropicClient) maxTokens() int {
	if c.MaxTokens > 0 {
		return c.MaxTokens
	}

	return DefaultMaxTokens
}

func normalizeSDKBaseURL(value string) string {
	baseURL := strings.TrimRight(strings.TrimSpace(value), "/")
	return strings.TrimSuffix(baseURL, "/v1")
}
