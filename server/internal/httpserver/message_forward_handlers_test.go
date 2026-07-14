package httpserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestForwardConversationMessagesSeparatelyToMultipleTargets(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	now := time.Now().UTC().Truncate(time.Second)
	alice := insertTestUser(t, db, "forward-alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "forward-bob@example.com", "Bob", store.UserStatusActive, now)
	carol := insertTestUser(t, db, "forward-carol@example.com", "Carol", store.UserStatusActive, now)
	source := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		lastMessageSeq:  2,
		memberIDs:       []string{alice.ID, bob.ID},
		name:            "源会话",
		now:             now,
	})
	targetOne := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		memberIDs:       []string{alice.ID, carol.ID},
		name:            "目标一",
		now:             now,
	})
	targetTwo := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindGroup,
		memberIDs:       []string{alice.ID, bob.ID, carol.ID},
		name:            "目标二",
		now:             now,
	})

	first := insertForwardTestMessage(t, db, source.ID, alice.ID, 1, map[string]any{
		"type":    "text",
		"content": "请看 {(@user/" + bob.ID + ")}",
	}, "请看 Bob", now)
	second := insertForwardTestMessage(t, db, source.ID, bob.ID, 2, map[string]any{
		"type":    "markdown",
		"content": "**第二条**",
	}, "第二条", now.Add(time.Minute))

	request := map[string]any{
		"client_forward_id":       uuid.NewString(),
		"message_ids":             []string{second.ID, first.ID},
		"mode":                    forwardMessageModeSeparate,
		"target_conversation_ids": []string{targetOne.ID, targetTwo.ID},
	}
	resp, body := postJSON(t, server, "/api/client/conversations/"+source.ID+"/messages/forward", request, loginAsUser(t, server, alice.Email))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %#v", resp.StatusCode, body)
	}
	data := requireSuccess(t, body)
	if data["sent_count"] != float64(2) || data["failed_count"] != float64(0) {
		t.Fatalf("forward counts = %#v", data)
	}

	for _, target := range []store.Conversation{targetOne, targetTwo} {
		var messages []store.Message
		if err := db.Where("conversation_id = ?", target.ID).Order("seq ASC").Find(&messages).Error; err != nil {
			t.Fatalf("find forwarded messages: %v", err)
		}
		if len(messages) != 2 {
			t.Fatalf("target %s message count = %d, want 2", target.ID, len(messages))
		}
		var firstBody textMessageBody
		if err := json.Unmarshal(messages[0].Body, &firstBody); err != nil {
			t.Fatalf("unmarshal first body: %v", err)
		}
		if firstBody.Content != "请看 @Bob" || strings.Contains(firstBody.Content, "{(@") {
			t.Fatalf("forwarded mention content = %q, want inert display text", firstBody.Content)
		}
	}

	duplicateResp, duplicateBody := postJSON(t, server, "/api/client/conversations/"+source.ID+"/messages/forward", request, loginAsUser(t, server, alice.Email))
	if duplicateResp.StatusCode != http.StatusOK {
		t.Fatalf("duplicate status = %d, body = %#v", duplicateResp.StatusCode, duplicateBody)
	}
	for _, target := range []store.Conversation{targetOne, targetTwo} {
		var count int64
		if err := db.Model(&store.Message{}).Where("conversation_id = ?", target.ID).Count(&count).Error; err != nil {
			t.Fatalf("count duplicate messages: %v", err)
		}
		if count != 2 {
			t.Fatalf("target %s message count after retry = %d, want 2", target.ID, count)
		}
	}
}

func TestForwardConversationMessagesMergedWithPartialTargetFailure(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	now := time.Now().UTC().Truncate(time.Second)
	alice := insertTestUser(t, db, "merge-alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "merge-bob@example.com", "Bob", store.UserStatusActive, now)
	source := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		lastMessageSeq:  2,
		memberIDs:       []string{alice.ID, bob.ID},
		name:            "源会话",
		now:             now,
	})
	target := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindGroup,
		memberIDs:       []string{alice.ID, bob.ID},
		name:            "目标会话",
		now:             now,
	})
	first := insertForwardTestMessage(t, db, source.ID, alice.ID, 1, map[string]any{
		"type":    "text",
		"content": "第一条",
	}, "第一条", now)
	second := insertForwardTestMessage(t, db, source.ID, bob.ID, 2, map[string]any{
		"type":    "text",
		"content": "第二条",
	}, "第二条", now.Add(time.Minute))

	resp, body := postJSON(t, server, "/api/client/conversations/"+source.ID+"/messages/forward", map[string]any{
		"client_forward_id":       uuid.NewString(),
		"message_ids":             []string{second.ID, first.ID},
		"mode":                    forwardMessageModeMerged,
		"target_conversation_ids": []string{target.ID, uuid.NewString()},
	}, loginAsUser(t, server, alice.Email))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %#v", resp.StatusCode, body)
	}
	data := requireSuccess(t, body)
	if data["sent_count"] != float64(1) || data["failed_count"] != float64(1) {
		t.Fatalf("forward counts = %#v", data)
	}

	var message store.Message
	if err := db.First(&message, "conversation_id = ?", target.ID).Error; err != nil {
		t.Fatalf("find merged message: %v", err)
	}
	if message.Summary != "[聊天记录] 2 条 - 第一条" {
		t.Fatalf("summary = %q", message.Summary)
	}
	var bundle forwardBundleMessageBody
	if err := json.Unmarshal(message.Body, &bundle); err != nil {
		t.Fatalf("unmarshal bundle: %v", err)
	}
	if bundle.Type != messageTypeForwardBundle || bundle.ItemCount != 2 || len(bundle.Items) != 2 {
		t.Fatalf("bundle = %#v", bundle)
	}
	if bundle.Items[0].SenderName != "Alice" || bundle.Items[0].Summary != "第一条" {
		t.Fatalf("first bundle item = %#v", bundle.Items[0])
	}

	var updatedTarget store.Conversation
	if err := db.First(&updatedTarget, "id = ?", target.ID).Error; err != nil {
		t.Fatalf("find target: %v", err)
	}
	if updatedTarget.LastMessageSummary != "[聊天记录] 2 条 - 第一条" {
		t.Fatalf("last message summary = %q", updatedTarget.LastMessageSummary)
	}
}

func TestForwardConversationMessagesMergedPreservesNestedBundle(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	now := time.Now().UTC().Truncate(time.Second)
	alice := insertTestUser(t, db, "nested-forward-alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "nested-forward-bob@example.com", "Bob", store.UserStatusActive, now)
	source := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		lastMessageSeq:  2,
		memberIDs:       []string{alice.ID, bob.ID},
		name:            "源会话",
		now:             now,
	})
	target := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindGroup,
		memberIDs:       []string{alice.ID, bob.ID},
		name:            "目标会话",
		now:             now,
	})

	nestedBundle := forwardBundleMessageBody{
		ItemCount: 2,
		Items: []forwardBundleItem{
			newForwardTestBundleItem(t, "内层第一条", "Alice", now.Add(-2*time.Minute)),
			newForwardTestBundleItem(t, "内层第二条", "Bob", now.Add(-time.Minute)),
		},
		Type: messageTypeForwardBundle,
	}
	nested := insertForwardTestMessage(
		t,
		db,
		source.ID,
		alice.ID,
		1,
		nestedBundle,
		"[聊天记录] 2 条 - 内层第一条",
		now,
	)
	plain := insertForwardTestMessage(t, db, source.ID, bob.ID, 2, map[string]any{
		"type":    "text",
		"content": "外层第二条",
	}, "外层第二条", now.Add(time.Minute))

	resp, responseBody := postJSON(t, server, "/api/client/conversations/"+source.ID+"/messages/forward", map[string]any{
		"client_forward_id":       uuid.NewString(),
		"message_ids":             []string{nested.ID, plain.ID},
		"mode":                    forwardMessageModeMerged,
		"target_conversation_ids": []string{target.ID},
	}, loginAsUser(t, server, alice.Email))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %#v", resp.StatusCode, responseBody)
	}

	var message store.Message
	if err := db.First(&message, "conversation_id = ?", target.ID).Error; err != nil {
		t.Fatalf("find nested merged message: %v", err)
	}
	if message.Summary != "[聊天记录] 2 条 - [聊天记录] 2 条 - 内层第一条" {
		t.Fatalf("summary = %q", message.Summary)
	}

	var outer forwardBundleMessageBody
	if err := json.Unmarshal(message.Body, &outer); err != nil {
		t.Fatalf("unmarshal outer bundle: %v", err)
	}
	if outer.ItemCount != 2 || len(outer.Items) != 2 {
		t.Fatalf("outer bundle = %#v", outer)
	}
	if outer.Items[0].SenderName != "Alice" || outer.Items[0].SentAt != now {
		t.Fatalf("outer nested item metadata = %#v", outer.Items[0])
	}

	var inner forwardBundleMessageBody
	if err := json.Unmarshal(outer.Items[0].Body, &inner); err != nil {
		t.Fatalf("unmarshal inner bundle: %v", err)
	}
	if inner.ItemCount != 2 || len(inner.Items) != 2 || inner.Items[0].Summary != "内层第一条" {
		t.Fatalf("inner bundle = %#v", inner)
	}
}

func TestForwardConversationMessagesRejectsSeparateNestedLeafOverflow(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	now := time.Now().UTC().Truncate(time.Second)
	alice := insertTestUser(t, db, "forward-limit-alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "forward-limit-bob@example.com", "Bob", store.UserStatusActive, now)
	source := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		lastMessageSeq:  2,
		memberIDs:       []string{alice.ID, bob.ID},
		name:            "源会话",
		now:             now,
	})
	target := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindGroup,
		memberIDs:       []string{alice.ID, bob.ID},
		name:            "目标会话",
		now:             now,
	})
	bundle := insertForwardTestMessage(
		t,
		db,
		source.ID,
		alice.ID,
		1,
		newForwardTestBundleWithLeaves(t, maxForwardMessageCount, now),
		"[聊天记录] 50 条 - 叶子消息 1",
		now,
	)
	plain := insertForwardTestMessage(t, db, source.ID, bob.ID, 2, map[string]any{
		"content": "额外消息",
		"type":    messageTypeText,
	}, "额外消息", now.Add(time.Minute))

	resp, responseBody := postJSON(t, server, "/api/client/conversations/"+source.ID+"/messages/forward", map[string]any{
		"client_forward_id":       uuid.NewString(),
		"message_ids":             []string{bundle.ID, plain.ID},
		"mode":                    forwardMessageModeSeparate,
		"target_conversation_ids": []string{target.ID},
	}, loginAsUser(t, server, alice.Email))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %#v", resp.StatusCode, responseBody)
	}
	requireError(t, responseBody, "invalid_request")

	var count int64
	if err := db.Model(&store.Message{}).Where("conversation_id = ?", target.ID).Count(&count).Error; err != nil {
		t.Fatalf("count target messages: %v", err)
	}
	if count != 0 {
		t.Fatalf("target message count = %d, want 0", count)
	}
}

func TestSanitizeForwardMessageBodyLimitsNestedBundleDepth(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	allowed := newNestedForwardTestBundle(t, maxForwardBundleDepth, now)
	_, _, metrics, err := sanitizeForwardMessageBody(allowed, nil, 0)
	if err != nil {
		t.Fatalf("sanitize allowed nested bundle: %v", err)
	}
	if metrics.BundleDepth != maxForwardBundleDepth || metrics.LeafCount != 1 {
		t.Fatalf("metrics = %#v", metrics)
	}

	tooDeep := newNestedForwardTestBundle(t, maxForwardBundleDepth+1, now)
	if _, _, _, err := sanitizeForwardMessageBody(tooDeep, nil, 0); !errors.Is(err, errForwardUnsupportedMessage) {
		t.Fatalf("sanitize too-deep bundle error = %v", err)
	}
}

func TestSanitizeForwardCardMessageBody(t *testing.T) {
	raw, err := json.Marshal(cardMessageBody{
		Description: "任务说明",
		Title:       "任务标题",
		Type:        messageTypeCard,
		URL:         "/projects/project-1?taskId=task-1",
	})
	if err != nil {
		t.Fatalf("marshal card message: %v", err)
	}

	sanitized, summary, metrics, err := sanitizeForwardMessageBody(raw, nil, 0)
	if err != nil {
		t.Fatalf("sanitize card message: %v", err)
	}
	if summary != "[卡片] 任务标题" {
		t.Fatalf("summary = %q, want card summary", summary)
	}
	if metrics.LeafCount != 1 || metrics.BundleDepth != 0 {
		t.Fatalf("metrics = %#v", metrics)
	}

	var body cardMessageBody
	if err := json.Unmarshal(sanitized, &body); err != nil {
		t.Fatalf("unmarshal sanitized card message: %v", err)
	}
	if body.URL != "/projects/project-1?taskId=task-1" || body.Description != "任务说明" {
		t.Fatalf("sanitized card message = %#v", body)
	}
}

func TestBuildForwardMessageDraftsLimitsNestedBundle(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	leafBody, err := json.Marshal(map[string]any{
		"content": "额外消息",
		"type":    messageTypeText,
	})
	if err != nil {
		t.Fatalf("marshal leaf body: %v", err)
	}
	leafSource := preparedForwardSource{
		Body:       leafBody,
		MessageID:  uuid.NewString(),
		Metrics:    forwardBodyMetrics{LeafCount: 1},
		SenderName: "Bob",
		SenderType: store.MessageSenderTypeUser,
		SentAt:     now,
		Summary:    "额外消息",
	}
	request := normalizedForwardMessagesRequest{
		ClientForwardID: uuid.NewString(),
		Mode:            forwardMessageModeMerged,
	}

	t.Run("depth", func(t *testing.T) {
		body, summary, metrics, err := sanitizeForwardMessageBody(
			newNestedForwardTestBundle(t, maxForwardBundleDepth, now),
			nil,
			0,
		)
		if err != nil {
			t.Fatalf("sanitize nested source: %v", err)
		}
		_, err = buildForwardMessageDrafts(request, []preparedForwardSource{{
			Body:       body,
			MessageID:  uuid.NewString(),
			Metrics:    metrics,
			SenderName: "Alice",
			SenderType: store.MessageSenderTypeUser,
			SentAt:     now,
			Summary:    summary,
		}, leafSource})
		if err == nil || !strings.Contains(err.Error(), "最多嵌套 5 层") {
			t.Fatalf("build too-deep merged bundle error = %v", err)
		}
	})

	t.Run("leaf count", func(t *testing.T) {
		body := newForwardTestBundleWithLeaves(t, maxForwardMessageCount, now)
		body, summary, metrics, err := sanitizeForwardMessageBody(body, nil, 0)
		if err != nil {
			t.Fatalf("sanitize full bundle: %v", err)
		}
		_, err = buildForwardMessageDrafts(request, []preparedForwardSource{{
			Body:       body,
			MessageID:  uuid.NewString(),
			Metrics:    metrics,
			SenderName: "Alice",
			SenderType: store.MessageSenderTypeUser,
			SentAt:     now,
			Summary:    summary,
		}, leafSource})
		if err == nil || !strings.Contains(err.Error(), "最多包含 50 条原始消息") {
			t.Fatalf("build oversized merged bundle error = %v", err)
		}
	})
}

func TestForwardConversationMessagesRejectsRevokedSource(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	now := time.Now().UTC().Truncate(time.Second)
	alice := insertTestUser(t, db, "revoked-forward@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "revoked-forward-bob@example.com", "Bob", store.UserStatusActive, now)
	source := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		lastMessageSeq:  1,
		memberIDs:       []string{alice.ID, bob.ID},
		name:            "源会话",
		now:             now,
	})
	target := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindGroup,
		memberIDs:       []string{alice.ID, bob.ID},
		name:            "目标会话",
		now:             now,
	})
	message := insertForwardTestMessage(t, db, source.ID, alice.ID, 1, map[string]any{
		"type":    "text",
		"content": "已撤回",
	}, "已撤回", now)
	if err := db.Model(&message).Updates(map[string]any{
		"revoked_at":         now,
		"revoked_by_user_id": alice.ID,
	}).Error; err != nil {
		t.Fatalf("revoke source: %v", err)
	}

	resp, body := postJSON(t, server, "/api/client/conversations/"+source.ID+"/messages/forward", map[string]any{
		"client_forward_id":       uuid.NewString(),
		"message_ids":             []string{message.ID},
		"mode":                    forwardMessageModeSeparate,
		"target_conversation_ids": []string{target.ID},
	}, loginAsUser(t, server, alice.Email))
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409, body = %#v", resp.StatusCode, body)
	}
	requireError(t, body, "source_unavailable")
}

func insertForwardTestMessage(t *testing.T, db *gorm.DB, conversationID string, senderID string, seq int64, body any, summary string, createdAt time.Time) store.Message {
	t.Helper()
	encodedBody, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal message body: %v", err)
	}
	message := store.Message{
		ID:             uuid.NewString(),
		ConversationID: conversationID,
		Seq:            seq,
		SenderType:     store.MessageSenderTypeUser,
		SenderID:       &senderID,
		Body:           encodedBody,
		Summary:        summary,
		CreatedAt:      createdAt,
		UpdatedAt:      createdAt,
	}
	if err := db.Create(&message).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}
	return message
}

func newForwardTestBundleItem(t *testing.T, content string, senderName string, sentAt time.Time) forwardBundleItem {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"content": content,
		"type":    messageTypeText,
	})
	if err != nil {
		t.Fatalf("marshal bundle item body: %v", err)
	}
	return forwardBundleItem{
		Body:       body,
		SenderName: senderName,
		SenderType: store.MessageSenderTypeUser,
		SentAt:     sentAt,
		Summary:    content,
	}
}

func newNestedForwardTestBundle(t *testing.T, depth int, sentAt time.Time) json.RawMessage {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"content": "叶子消息",
		"type":    messageTypeText,
	})
	if err != nil {
		t.Fatalf("marshal leaf message: %v", err)
	}
	for level := 0; level < depth; level++ {
		body, err = json.Marshal(forwardBundleMessageBody{
			ItemCount: 1,
			Items: []forwardBundleItem{{
				Body:       body,
				SenderName: "Alice",
				SenderType: store.MessageSenderTypeUser,
				SentAt:     sentAt,
				Summary:    "叶子消息",
			}},
			Type: messageTypeForwardBundle,
		})
		if err != nil {
			t.Fatalf("marshal nested bundle level %d: %v", level+1, err)
		}
	}
	return body
}

func newForwardTestBundleWithLeaves(t *testing.T, count int, sentAt time.Time) json.RawMessage {
	t.Helper()
	items := make([]forwardBundleItem, 0, count)
	for index := 0; index < count; index++ {
		items = append(items, newForwardTestBundleItem(
			t,
			fmt.Sprintf("叶子消息 %d", index+1),
			"Alice",
			sentAt,
		))
	}
	body, err := json.Marshal(forwardBundleMessageBody{
		ItemCount: count,
		Items:     items,
		Type:      messageTypeForwardBundle,
	})
	if err != nil {
		t.Fatalf("marshal bundle with %d leaves: %v", count, err)
	}
	return body
}
