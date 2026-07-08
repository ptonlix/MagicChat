package appclient

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"assistant/internal/agent"

	"github.com/gorilla/websocket"
)

type replyAgentFunc func(context.Context, agent.Request) (string, error)

func (f replyAgentFunc) Reply(ctx context.Context, request agent.Request) (string, error) {
	return f(ctx, request)
}

type appRequestFunc func(context.Context, string, any) (json.RawMessage, error)

func (f appRequestFunc) Request(ctx context.Context, method string, payload any) (json.RawMessage, error) {
	return f(ctx, method, payload)
}

func TestHandleServerMessageSendsLLMReply(t *testing.T) {
	body, err := json.Marshal(textMessageBody{
		Type:    "text",
		Content: "你好",
	})
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	payload, err := json.Marshal(messageCreatedPayload{
		Conversation: conversationPayload{
			ID:   "conversation-1",
			Name: "AI 女菩萨",
			Type: "app",
		},
		Message: messagePayload{
			Body:    body,
			ID:      "message-1",
			Seq:     3,
			Summary: "你好",
		},
		Sender: senderPayload{
			ID:   "user-1",
			Name: "Alice",
			Type: "user",
		},
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	raw, err := json.Marshal(envelope{
		V:       protocolVersion,
		Kind:    kindEvent,
		ID:      "event-1",
		Event:   eventMessageCreated,
		Payload: payload,
	})
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}

	var sent []envelope
	var agentRequests []agent.Request
	var historyMethod string
	var historyPayload appListConversationMessagesRequestPayload
	requester := appRequestFunc(func(ctx context.Context, method string, payload any) (json.RawMessage, error) {
		historyMethod = method
		var err error
		rawPayload, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal history request payload: %v", err)
		}
		if err := json.Unmarshal(rawPayload, &historyPayload); err != nil {
			t.Fatalf("unmarshal history request payload: %v", err)
		}
		return json.Marshal(appListConversationMessagesResponsePayload{
			Messages: []historyMessagePayload{
				{
					CreatedAt: time.Date(2026, 7, 8, 10, 0, 0, 0, time.UTC),
					ID:        "history-1",
					Seq:       1,
					Sender: senderPayload{
						ID:   "user-1",
						Name: "Alice",
						Type: "user",
					},
					Summary: "之前问了部署时间",
				},
				{
					CreatedAt: time.Date(2026, 7, 8, 10, 1, 0, 0, time.UTC),
					ID:        "history-2",
					Seq:       2,
					Sender: senderPayload{
						ID:   "assistant-app",
						Name: "女菩萨",
						Type: "app",
					},
					Summary: "回复预计今天下午完成",
				},
				{
					CreatedAt: time.Date(2026, 7, 8, 10, 2, 0, 0, time.UTC),
					ID:        "message-1",
					Seq:       3,
					Sender: senderPayload{
						ID:   "user-1",
						Name: "Alice",
						Type: "user",
					},
					Summary: "你好",
				},
			},
		})
	})
	replyAgent := replyAgentFunc(func(ctx context.Context, request agent.Request) (string, error) {
		agentRequests = append(agentRequests, request)
		return "你好，我是大模型回复", nil
	})

	handleServerMessage(context.Background(), websocket.TextMessage, raw, requester, replyAgent, func(message envelope) error {
		sent = append(sent, message)
		return nil
	})

	if historyMethod != methodConversationMessagesList {
		t.Fatalf("history method = %q, want %s", historyMethod, methodConversationMessagesList)
	}
	if historyPayload.ConversationID != "conversation-1" {
		t.Fatalf("history conversation_id = %q, want conversation-1", historyPayload.ConversationID)
	}
	if historyPayload.BeforeOrEqualSeq != 3 {
		t.Fatalf("history before_or_equal_seq = %d, want 3", historyPayload.BeforeOrEqualSeq)
	}
	if historyPayload.Limit != defaultConversationContextLimit {
		t.Fatalf("history limit = %d, want %d", historyPayload.Limit, defaultConversationContextLimit)
	}
	if len(agentRequests) != 1 {
		t.Fatalf("agent request count = %d, want 1", len(agentRequests))
	}
	agentRequest := agentRequests[0]
	if agentRequest.Content != "你好" {
		t.Fatalf("agent content = %q, want 你好", agentRequest.Content)
	}
	if agentRequest.MessageID != "message-1" {
		t.Fatalf("agent message id = %q, want message-1", agentRequest.MessageID)
	}
	if agentRequest.Conversation.ID != "conversation-1" {
		t.Fatalf("agent conversation id = %q, want conversation-1", agentRequest.Conversation.ID)
	}
	if agentRequest.Conversation.Name != "AI 女菩萨" {
		t.Fatalf("agent conversation name = %q, want AI 女菩萨", agentRequest.Conversation.Name)
	}
	if agentRequest.Conversation.Type != "app" {
		t.Fatalf("agent conversation type = %q, want app", agentRequest.Conversation.Type)
	}
	if agentRequest.Sender.ID != "user-1" {
		t.Fatalf("agent sender id = %q, want user-1", agentRequest.Sender.ID)
	}
	if agentRequest.Sender.Name != "Alice" {
		t.Fatalf("agent sender name = %q, want Alice", agentRequest.Sender.Name)
	}
	if agentRequest.Sender.Type != "user" {
		t.Fatalf("agent sender type = %q, want user", agentRequest.Sender.Type)
	}
	if len(agentRequest.History) != 2 {
		t.Fatalf("agent history count = %d, want 2", len(agentRequest.History))
	}
	if agentRequest.History[0].Summary != "之前问了部署时间" {
		t.Fatalf("first history summary = %q, want previous summary", agentRequest.History[0].Summary)
	}
	if agentRequest.History[1].SenderName != "女菩萨" {
		t.Fatalf("second history sender = %q, want 女菩萨", agentRequest.History[1].SenderName)
	}
	if len(sent) != 1 {
		t.Fatalf("sent count = %d, want 1", len(sent))
	}
	request := sent[0]
	if request.V != protocolVersion {
		t.Fatalf("request version = %d, want %d", request.V, protocolVersion)
	}
	if request.Kind != kindRequest {
		t.Fatalf("request kind = %q, want request", request.Kind)
	}
	if request.Method != methodMessageSend {
		t.Fatalf("request method = %q, want %s", request.Method, methodMessageSend)
	}
	if request.ID == "" {
		t.Fatal("request id is empty")
	}

	var requestPayload sendMessageRequestPayload
	if err := json.Unmarshal(request.Payload, &requestPayload); err != nil {
		t.Fatalf("unmarshal request payload: %v", err)
	}
	if requestPayload.Target.Type != "app" {
		t.Fatalf("target.type = %q, want app", requestPayload.Target.Type)
	}
	if requestPayload.Target.ConversationID != "conversation-1" {
		t.Fatalf("target.conversation_id = %q, want conversation-1", requestPayload.Target.ConversationID)
	}
	if requestPayload.Message.Type != "text" {
		t.Fatalf("message.type = %q, want text", requestPayload.Message.Type)
	}
	if requestPayload.Message.Content != "你好，我是大模型回复" {
		t.Fatalf("message.content = %q, want LLM reply", requestPayload.Message.Content)
	}
}
