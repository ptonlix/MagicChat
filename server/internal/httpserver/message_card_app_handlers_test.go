package httpserver

import (
	"context"
	"encoding/json"
	"testing"
)

func TestPrepareAppSendMessageBodySupportsCard(t *testing.T) {
	raw, err := json.Marshal(cardMessageBody{
		Description: "  任务说明  ",
		Title:       "  任务标题  ",
		Type:        messageTypeCard,
		URL:         "  /projects/project-1?taskId=task-1  ",
	})
	if err != nil {
		t.Fatalf("marshal card message: %v", err)
	}

	prepared, err := (&Server{}).prepareAppSendMessageBody(context.Background(), raw)
	if err != nil {
		t.Fatalf("prepare app card message: %v", err)
	}
	finalBody, summary, err := prepared.Finalize(context.Background(), prepared.Body)
	if err != nil {
		t.Fatalf("finalize app card message: %v", err)
	}
	if summary != "[卡片] 任务标题" {
		t.Fatalf("summary = %q, want card summary", summary)
	}

	var body cardMessageBody
	if err := json.Unmarshal(finalBody, &body); err != nil {
		t.Fatalf("unmarshal final card message: %v", err)
	}
	if body.Title != "任务标题" || body.Description != "任务说明" || body.URL != "/projects/project-1?taskId=task-1" {
		t.Fatalf("body = %#v, want normalized card message", body)
	}
}
