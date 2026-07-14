package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"app/internal/store"
)

func TestChartMessageHandlerNormalizesSupportedTypes(t *testing.T) {
	testCases := []struct {
		chartType string
		data      any
	}{
		{
			chartType: chartTypeLine,
			data: map[string]any{
				"labels": []string{" 周一 ", "周二"},
				"series": []any{map[string]any{"name": " 发送 ", "values": []any{12, nil}}},
			},
		},
		{
			chartType: chartTypeBar,
			data: map[string]any{
				"direction": chartBarDirectionHorizontal,
				"mode":      chartBarModeStacked,
				"labels":    []string{"一月"},
				"series":    []any{map[string]any{"name": "新增", "values": []any{12}}},
			},
		},
		{
			chartType: chartTypePie,
			data: map[string]any{
				"items": []any{
					map[string]any{"name": "待办", "value": 12},
					map[string]any{"name": "完成", "value": 8},
				},
			},
		},
		{
			chartType: chartTypeRadar,
			data: map[string]any{
				"axes": []any{
					map[string]any{"name": "进度", "max": 100},
					map[string]any{"name": "质量", "max": 100},
					map[string]any{"name": "协作", "max": 100},
				},
				"series": []any{map[string]any{"name": "本周", "values": []any{80, 92, 76}}},
			},
		},
	}

	handler := chartMessageBodyHandler{}
	for _, testCase := range testCases {
		t.Run(testCase.chartType, func(t *testing.T) {
			raw := marshalChartTestBody(t, testCase.chartType, testCase.data)
			normalized, err := handler.Normalize(context.Background(), raw)
			if err != nil {
				t.Fatalf("Normalize() error = %v", err)
			}
			var body chartMessageBody
			if err := json.Unmarshal(normalized, &body); err != nil {
				t.Fatalf("unmarshal normalized chart: %v", err)
			}
			if body.Type != messageTypeChart || body.ChartType != testCase.chartType || body.Title != "项目趋势" || body.Description != "单位：个，按自然日统计" {
				t.Fatalf("normalized body = %#v", body)
			}
			summary, err := handler.Summary(normalized)
			if err != nil {
				t.Fatalf("Summary() error = %v", err)
			}
			if summary != "[图表] 项目趋势" {
				t.Fatalf("summary = %q", summary)
			}
		})
	}
}

func TestChartMessageHandlerRejectsInvalidBodies(t *testing.T) {
	validLineData := map[string]any{
		"labels": []string{"周一", "周二"},
		"series": []any{map[string]any{"name": "发送", "values": []any{12, 18}}},
	}
	testCases := []struct {
		name string
		raw  json.RawMessage
	}{
		{"body too large", json.RawMessage(strings.Repeat(" ", maxChartMessageBodyBytes+1))},
		{"unknown top-level field", json.RawMessage(`{"type":"chart","chart_type":"line","title":"趋势","description":"说明","data":{"labels":["一","二"],"series":[{"name":"数量","values":[1,2]}]},"color":"red"}`)},
		{"unsupported chart type", marshalChartTestBody(t, "area", validLineData)},
		{"title too long", marshalChartTestBodyWithText(t, chartTypeLine, validLineData, strings.Repeat("图", maxChartTitleLength+1), "说明")},
		{"description too long", marshalChartTestBodyWithText(t, chartTypeLine, validLineData, "趋势", strings.Repeat("说", maxChartDescriptionLength+1))},
		{"line needs two labels", marshalChartTestBody(t, chartTypeLine, map[string]any{"labels": []string{"周一"}, "series": []any{map[string]any{"name": "数量", "values": []any{1}}}})},
		{"line value count mismatch", marshalChartTestBody(t, chartTypeLine, map[string]any{"labels": []string{"周一", "周二"}, "series": []any{map[string]any{"name": "数量", "values": []any{1}}}})},
		{"line duplicate series", marshalChartTestBody(t, chartTypeLine, map[string]any{"labels": []string{"周一", "周二"}, "series": []any{map[string]any{"name": "数量", "values": []any{1, 2}}, map[string]any{"name": "数量", "values": []any{2, 3}}}})},
		{"line value too large", marshalChartTestBody(t, chartTypeLine, map[string]any{"labels": []string{"周一", "周二"}, "series": []any{map[string]any{"name": "数量", "values": []any{float64(maxChartValue) * 2, 2}}}})},
		{"bar invalid direction", marshalChartTestBody(t, chartTypeBar, map[string]any{"direction": "diagonal", "mode": chartBarModeGrouped, "labels": []string{"一月"}, "series": []any{map[string]any{"name": "数量", "values": []any{1}}}})},
		{"bar invalid mode", marshalChartTestBody(t, chartTypeBar, map[string]any{"direction": chartBarDirectionVertical, "mode": "mixed", "labels": []string{"一月"}, "series": []any{map[string]any{"name": "数量", "values": []any{1}}}})},
		{"pie non-positive value", marshalChartTestBody(t, chartTypePie, map[string]any{"items": []any{map[string]any{"name": "待办", "value": 1}, map[string]any{"name": "完成", "value": 0}}})},
		{"pie value too large", marshalChartTestBody(t, chartTypePie, map[string]any{"items": []any{map[string]any{"name": "待办", "value": float64(maxChartValue) * 2}, map[string]any{"name": "完成", "value": 1}}})},
		{"radar null value", marshalChartTestBody(t, chartTypeRadar, map[string]any{"axes": []any{map[string]any{"name": "进度", "max": 100}, map[string]any{"name": "质量", "max": 100}, map[string]any{"name": "协作", "max": 100}}, "series": []any{map[string]any{"name": "本周", "values": []any{80, nil, 76}}}})},
		{"radar value above max", marshalChartTestBody(t, chartTypeRadar, map[string]any{"axes": []any{map[string]any{"name": "进度", "max": 100}, map[string]any{"name": "质量", "max": 100}, map[string]any{"name": "协作", "max": 100}}, "series": []any{map[string]any{"name": "本周", "values": []any{101, 92, 76}}}})},
		{"radar max too large", marshalChartTestBody(t, chartTypeRadar, map[string]any{"axes": []any{map[string]any{"name": "进度", "max": float64(maxChartValue) * 2}, map[string]any{"name": "质量", "max": 100}, map[string]any{"name": "协作", "max": 100}}, "series": []any{map[string]any{"name": "本周", "values": []any{80, 92, 76}}}})},
		{"unknown data field", marshalChartTestBody(t, chartTypeLine, map[string]any{"labels": []string{"一", "二"}, "series": []any{map[string]any{"name": "数量", "values": []any{1, 2}}}, "color": "red"})},
	}

	handler := chartMessageBodyHandler{}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if err := handler.Validate(testCase.raw); err == nil {
				t.Fatal("Validate() error = nil, want error")
			}
		})
	}
}

func TestChartMessageHandlerAcceptsOneHundredLabels(t *testing.T) {
	labels := make([]string, maxChartLabels)
	values := make([]any, maxChartLabels)
	for index := range labels {
		labels[index] = "标签"
		values[index] = index
	}
	raw := marshalChartTestBody(t, chartTypeLine, map[string]any{
		"labels": labels,
		"series": []any{map[string]any{"name": "数量", "values": values}},
	})
	if err := (chartMessageBodyHandler{}).Validate(raw); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}

	labels = append(labels, "超限标签")
	values = append(values, maxChartLabels)
	overLimit := marshalChartTestBody(t, chartTypeLine, map[string]any{
		"labels": labels,
		"series": []any{map[string]any{"name": "数量", "values": values}},
	})
	if err := (chartMessageBodyHandler{}).Validate(overLimit); err == nil {
		t.Fatal("Validate() error = nil, want more than 100 labels to fail")
	}
}

func TestCreateConversationChartMessageRejectsInvalidBodyWithoutSaving(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 14, 9, 0, 0, 0, time.UTC)
	alice := insertTestUser(t, db, "chart-alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "chart-bob@example.com", "Bob", store.UserStatusActive, now)
	conversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		memberIDs:       []string{alice.ID, bob.ID},
		now:             now,
	})

	var before int64
	if err := db.Model(&store.Message{}).Where("conversation_id = ?", conversation.ID).Count(&before).Error; err != nil {
		t.Fatalf("count messages before request: %v", err)
	}
	resp, body := postJSON(t, server, "/api/client/conversations/"+conversation.ID+"/messages", map[string]any{
		"client_message_id": "invalid-chart-1",
		"body": map[string]any{
			"type":        messageTypeChart,
			"chart_type":  chartTypeLine,
			"title":       "趋势",
			"description": "按自然日统计",
			"data": map[string]any{
				"labels": []string{"周一", "周二"},
				"series": []any{map[string]any{"name": "数量", "values": []any{1}}},
			},
		},
	}, loginAsUser(t, server, alice.Email))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %#v", resp.StatusCode, body)
	}
	requireError(t, body, "invalid_request")

	var after int64
	if err := db.Model(&store.Message{}).Where("conversation_id = ?", conversation.ID).Count(&after).Error; err != nil {
		t.Fatalf("count messages after request: %v", err)
	}
	if after != before {
		t.Fatalf("message count = %d, want %d", after, before)
	}
}

func TestCreateConversationMessageRejectsOversizedRequestBeforeBinding(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 14, 9, 0, 0, 0, time.UTC)
	alice := insertTestUser(t, db, "large-chart-alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "large-chart-bob@example.com", "Bob", store.UserStatusActive, now)
	conversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		memberIDs:       []string{alice.ID, bob.ID},
		now:             now,
	})

	resp, body := postJSON(t, server, "/api/client/conversations/"+conversation.ID+"/messages", map[string]any{
		"client_message_id": "oversized-chart-1",
		"body": map[string]any{
			"type":        messageTypeChart,
			"chart_type":  chartTypePie,
			"title":       "超大图表",
			"description": strings.Repeat("x", maxCreateMessageRequestBytes),
			"data": map[string]any{
				"items": []any{
					map[string]any{"name": "待办", "value": 12},
					map[string]any{"name": "完成", "value": 8},
				},
			},
		},
	}, loginAsUser(t, server, alice.Email))
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413, body = %#v", resp.StatusCode, body)
	}
	requireError(t, body, "request_too_large")

	var count int64
	if err := db.Model(&store.Message{}).Where("conversation_id = ?", conversation.ID).Count(&count).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if count != 0 {
		t.Fatalf("message count = %d, want 0", count)
	}
}

func TestCreateConversationChartMessageNormalizesAndStoresSummary(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 14, 9, 0, 0, 0, time.UTC)
	alice := insertTestUser(t, db, "valid-chart-alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "valid-chart-bob@example.com", "Bob", store.UserStatusActive, now)
	conversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		memberIDs:       []string{alice.ID, bob.ID},
		now:             now,
	})

	resp, body := postJSON(t, server, "/api/client/conversations/"+conversation.ID+"/messages", map[string]any{
		"client_message_id": "valid-chart-1",
		"body": map[string]any{
			"type":        messageTypeChart,
			"chart_type":  chartTypeLine,
			"title":       "  项目趋势  ",
			"description": "  单位：个，按自然日统计  ",
			"data": map[string]any{
				"labels": []string{" 周一 ", "周二"},
				"series": []any{map[string]any{"name": " 数量 ", "values": []any{12, 18}}},
			},
		},
	}, loginAsUser(t, server, alice.Email))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201, body = %#v", resp.StatusCode, body)
	}
	created := requireSuccess(t, body)["message"].(map[string]any)
	messageBody := created["body"].(map[string]any)
	if messageBody["type"] != messageTypeChart || messageBody["chart_type"] != chartTypeLine || messageBody["title"] != "项目趋势" || messageBody["description"] != "单位：个，按自然日统计" {
		t.Fatalf("message.body = %#v", messageBody)
	}

	var stored store.Message
	if err := db.First(&stored, "id = ?", created["id"]).Error; err != nil {
		t.Fatalf("find stored chart message: %v", err)
	}
	if stored.Summary != "[图表] 项目趋势" {
		t.Fatalf("stored summary = %q", stored.Summary)
	}
}

func TestPrepareAppSendMessageBodySupportsChart(t *testing.T) {
	raw := marshalChartTestBody(t, chartTypePie, map[string]any{
		"items": []any{
			map[string]any{"name": "待办", "value": 12},
			map[string]any{"name": "完成", "value": 8},
		},
	})
	prepared, err := (&Server{}).prepareAppSendMessageBody(context.Background(), raw)
	if err != nil {
		t.Fatalf("prepareAppSendMessageBody() error = %v", err)
	}
	_, summary, err := prepared.Finalize(context.Background(), prepared.Body)
	if err != nil {
		t.Fatalf("Finalize() error = %v", err)
	}
	if summary != "[图表] 项目趋势" {
		t.Fatalf("summary = %q", summary)
	}
}

func TestSanitizeForwardChartMessageBody(t *testing.T) {
	raw := marshalChartTestBody(t, chartTypePie, map[string]any{
		"items": []any{
			map[string]any{"name": "待办", "value": 12},
			map[string]any{"name": "完成", "value": 8},
		},
	})
	sanitized, summary, metrics, err := sanitizeForwardMessageBody(raw, nil, 0)
	if err != nil {
		t.Fatalf("sanitizeForwardMessageBody() error = %v", err)
	}
	if string(sanitized) != string(raw) || summary != "[图表] 项目趋势" || metrics.LeafCount != 1 {
		t.Fatalf("sanitized = %s, summary = %q, metrics = %#v", sanitized, summary, metrics)
	}
}

func marshalChartTestBody(t *testing.T, chartType string, data any) json.RawMessage {
	t.Helper()
	return marshalChartTestBodyWithText(t, chartType, data, "  项目趋势  ", "  单位：个，按自然日统计  ")
}

func marshalChartTestBodyWithText(t *testing.T, chartType string, data any, title string, description string) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"type":        messageTypeChart,
		"chart_type":  chartType,
		"title":       title,
		"data":        data,
		"description": description,
	})
	if err != nil {
		t.Fatalf("marshal chart body: %v", err)
	}
	return raw
}
