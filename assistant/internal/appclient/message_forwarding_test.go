package appclient

import (
	"strings"
	"testing"
	"time"
)

func TestBuildAgentMessageContentForForwardBundle(t *testing.T) {
	sentAt := time.Date(2026, 7, 13, 10, 0, 0, 0, time.UTC)
	body := messageBody{
		Type:      "forward_bundle",
		ItemCount: 2,
		Items: []forwardBundleItemPayload{
			{
				Body:       messageBody{Type: "text", Content: "第一条"},
				SenderName: "Alice",
				SenderType: "user",
				SentAt:     sentAt,
				Summary:    "第一条",
			},
			{
				Body: messageBody{
					Type:      "forward_bundle",
					ItemCount: 1,
					Items: []forwardBundleItemPayload{{
						Body:       messageBody{Type: "file", FileID: "file-1", Name: "计划.pdf", SizeBytes: 42},
						SenderName: "Carol",
						SenderType: "user",
						SentAt:     sentAt.Add(-time.Minute),
						Summary:    "[文件] 计划.pdf",
					}},
				},
				SenderName: "Bob",
				SenderType: "user",
				SentAt:     sentAt.Add(time.Minute),
				Summary:    "[聊天记录] 1 条 - [文件] 计划.pdf",
			},
		},
	}

	content, err := buildAgentMessageContent(body, map[string]temporaryFileReadURLPayload{
		"file-1": {FileID: "file-1", URL: "https://files.example.test/file-1"},
	})
	if err != nil {
		t.Fatalf("build content: %v", err)
	}
	for _, expected := range []string{"共 2 条", "Alice", "第一条", "Bob", "共 1 条", "Carol", "计划.pdf", "https://files.example.test/file-1"} {
		if !strings.Contains(content, expected) {
			t.Fatalf("content = %q, want %q", content, expected)
		}
	}

	fileIDs, err := collectTemporaryFileIDs(body)
	if err != nil {
		t.Fatalf("collect file IDs: %v", err)
	}
	if len(fileIDs) != 1 || fileIDs[0] != "file-1" {
		t.Fatalf("file IDs = %#v", fileIDs)
	}
}

func TestBuildAgentMessageContentForCard(t *testing.T) {
	if !isSupportedIncomingMessageType("card") {
		t.Fatal("card should be accepted as an incoming message")
	}

	body := messageBody{
		Description: "任务说明",
		Title:       "任务标题",
		Type:        "card",
		URL:         "/projects/project-1?taskId=task-1",
	}

	content, err := buildAgentMessageContent(body, nil)
	if err != nil {
		t.Fatalf("build content: %v", err)
	}
	for _, expected := range []string{"卡片消息", "任务标题", "任务说明", "/projects/project-1?taskId=task-1"} {
		if !strings.Contains(content, expected) {
			t.Fatalf("content = %q, want %q", content, expected)
		}
	}
}
