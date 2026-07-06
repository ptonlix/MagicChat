package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"app/internal/store"

	"gorm.io/gorm"
)

const (
	llmHealthCheckInitialDelay   = 5 * time.Second
	llmHealthCheckInterval       = 5 * time.Minute
	llmHealthCheckTimeout        = 15 * time.Second
	llmHealthCheckMaxConcurrency = 3
	llmHealthCheckMaxTokens      = 64
	anthropicVersion             = "2023-06-01"
)

var errLLMHealthCheckRunning = errors.New("llm health check running")

type LLMHealthChecker struct {
	db             *gorm.DB
	httpClient     *http.Client
	timeout        time.Duration
	interval       time.Duration
	initialDelay   time.Duration
	maxConcurrency int

	mu      sync.Mutex
	running map[string]struct{}
}

func NewLLMHealthChecker(db *gorm.DB) *LLMHealthChecker {
	return &LLMHealthChecker{
		db:             db,
		httpClient:     http.DefaultClient,
		timeout:        llmHealthCheckTimeout,
		interval:       llmHealthCheckInterval,
		initialDelay:   llmHealthCheckInitialDelay,
		maxConcurrency: llmHealthCheckMaxConcurrency,
		running:        map[string]struct{}{},
	}
}

func (checker *LLMHealthChecker) Start(ctx context.Context) {
	go checker.run(ctx)
}

func (checker *LLMHealthChecker) run(ctx context.Context) {
	timer := time.NewTimer(checker.initialDelay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return
	case <-timer.C:
		checker.CheckEnabledModels(ctx)
	}

	ticker := time.NewTicker(checker.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			checker.CheckEnabledModels(ctx)
		}
	}
}

func (checker *LLMHealthChecker) CheckEnabledModels(ctx context.Context) {
	var models []store.LLMModel
	if err := checker.db.Where("enabled = ?", true).Order("sort_order ASC").Order("display_name ASC").Order("id ASC").Find(&models).Error; err != nil {
		return
	}

	sem := make(chan struct{}, checker.maxConcurrency)
	var wg sync.WaitGroup
	for _, model := range models {
		model := model
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}

			_, _ = checker.CheckModel(ctx, model)
		}()
	}
	wg.Wait()
}

func (checker *LLMHealthChecker) CheckModelByID(ctx context.Context, id string) (store.LLMModel, error) {
	var model store.LLMModel
	err := checker.db.First(&model, "id = ?", id).Error
	if err != nil {
		return store.LLMModel{}, err
	}

	return checker.CheckModel(ctx, model)
}

func (checker *LLMHealthChecker) CheckModel(ctx context.Context, model store.LLMModel) (store.LLMModel, error) {
	if !checker.markRunning(model.ID) {
		return model, errLLMHealthCheckRunning
	}
	defer checker.clearRunning(model.ID)

	requestContext, cancel := context.WithTimeout(ctx, checker.timeout)
	defer cancel()

	startedAt := time.Now()
	checkErr := checker.checkAnthropic(requestContext, model)
	durationMS := int(time.Since(startedAt).Milliseconds())
	if durationMS < 1 {
		durationMS = 1
	}
	now := time.Now().UTC()
	updates := map[string]any{
		"last_checked_at": now,
	}
	if checkErr == nil {
		updates["connectivity_status"] = store.LLMConnectivityStatusConnected
		updates["last_connected_at"] = now
		updates["last_error_message"] = ""
		updates["last_response_duration_ms"] = durationMS
	} else {
		updates["connectivity_status"] = store.LLMConnectivityStatusFailed
		updates["last_error_message"] = truncateLLMHealthError(checkErr.Error())
		updates["last_response_duration_ms"] = nil
	}

	if err := checker.db.Model(&store.LLMModel{}).Where("id = ?", model.ID).Updates(updates).Error; err != nil {
		return store.LLMModel{}, err
	}

	var updatedModel store.LLMModel
	if err := checker.db.First(&updatedModel, "id = ?", model.ID).Error; err != nil {
		return store.LLMModel{}, err
	}

	return updatedModel, nil
}

func (checker *LLMHealthChecker) checkAnthropic(ctx context.Context, model store.LLMModel) error {
	messagesURL, err := anthropicMessagesURL(model.BaseURL)
	if err != nil {
		return err
	}

	body, err := json.Marshal(map[string]any{
		"model":      model.ModelName,
		"max_tokens": llmHealthCheckMaxTokens,
		"messages": []map[string]string{
			{
				"role":    "user",
				"content": "ping",
			},
		},
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, messagesURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", model.APIKey)
	req.Header.Set("anthropic-version", anthropicVersion)

	resp, err := checker.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("anthropic health check failed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
	}

	var decoded struct {
		Type    string `json:"type"`
		Role    string `json:"role"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&decoded); err != nil {
		return fmt.Errorf("decode anthropic response: %w", err)
	}
	if decoded.Type != "message" || decoded.Role != "assistant" || len(decoded.Content) == 0 {
		return errors.New("anthropic response format invalid")
	}

	return nil
}

func (checker *LLMHealthChecker) markRunning(id string) bool {
	checker.mu.Lock()
	defer checker.mu.Unlock()

	if _, ok := checker.running[id]; ok {
		return false
	}
	checker.running[id] = struct{}{}

	return true
}

func (checker *LLMHealthChecker) clearRunning(id string) {
	checker.mu.Lock()
	defer checker.mu.Unlock()

	delete(checker.running, id)
}

func anthropicMessagesURL(baseURL string) (string, error) {
	return anthropicAPIURL(baseURL, "messages")
}

func anthropicModelsURL(baseURL string) (string, error) {
	return anthropicAPIURL(baseURL, "models")
}

func anthropicAPIURL(baseURL string, resource string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("Base URL 格式错误")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", errors.New("Base URL 格式错误")
	}

	path := strings.TrimRight(parsed.Path, "/")
	resource = strings.Trim(resource, "/")
	if strings.HasSuffix(path, "/v1") {
		parsed.Path = path + "/" + resource
	} else {
		parsed.Path = path + "/v1/" + resource
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""

	return parsed.String(), nil
}

func truncateLLMHealthError(message string) string {
	const maxLength = 1000
	message = strings.ToValidUTF8(strings.TrimSpace(message), "")
	if len(message) <= maxLength {
		return message
	}

	truncatedLength := 0
	for truncatedLength < len(message) {
		_, size := utf8.DecodeRuneInString(message[truncatedLength:])
		if truncatedLength+size > maxLength {
			break
		}
		truncatedLength += size
	}

	return message[:truncatedLength]
}
