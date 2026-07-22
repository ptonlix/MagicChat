package httpserver

import (
	"context"
	"encoding/json"
	"testing"

	conversationapp "app/internal/application/conversation"
	messageapp "app/internal/application/message"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestConversationApplicationMessageResponseUsesEmptyReactionArray(t *testing.T) {
	response := newConversationApplicationMessageResponse(conversationapp.Message{
		ConversationID: "conversation-id", ID: "message-id",
		Sender: conversationapp.MessageIdentity{Type: "system"},
	})
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if reactions, ok := payload["reactions"].([]any); !ok || len(reactions) != 0 {
		t.Fatalf("reactions = %#v, want empty array", payload["reactions"])
	}
}

func TestMessageCreatedEventIncludesNotificationMuteState(t *testing.T) {
	event := realtimeMessageCreatedEvent(messageResponse{ID: "message-id"}, true)
	var payload messageCreatedEventPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		t.Fatalf("unmarshal message event: %v", err)
	}
	if !payload.NotificationMuted || payload.Message.ID != "message-id" {
		t.Fatalf("message event payload = %#v", payload)
	}
}

func TestNotificationPreferenceLookupFailureSuppressesNotifications(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	server := &Server{db: db}
	mutedUsers := server.loadNotificationMutedTargets(context.Background(), "conversation-1", []string{"user-1", "user-2"})
	if !mutedUsers["user-1"] || !mutedUsers["user-2"] {
		t.Fatalf("muted users after lookup failure = %#v", mutedUsers)
	}
	deliveries := []messageapp.Delivery{
		{Message: messageapp.Message{ConversationID: "conversation-1"}, UserID: "user-1"},
		{Message: messageapp.Message{ConversationID: "conversation-2"}, UserID: "user-2"},
	}
	mutedDeliveries := server.loadDeliveryNotificationMutedTargets(context.Background(), deliveries)
	for _, delivery := range deliveries {
		if !mutedDeliveries[notificationTargetKey(delivery.Message.ConversationID, delivery.UserID)] {
			t.Fatalf("muted deliveries after lookup failure = %#v", mutedDeliveries)
		}
	}
}

func TestMessageReactionEventIncludesUsers(t *testing.T) {
	event := realtimeMessageReactionsUpdatedEvent(messageapp.ReactionEvent{
		ConversationID: "conversation-id", MessageID: "message-id", ReactionVersion: 2,
		Reactions: []messageapp.ReactionCount{{
			Count: 4, Text: "👍", Users: []messageapp.ReactionUser{
				{ID: "user-1", Name: "Alice"}, {ID: "user-2", Name: "Bob"}, {ID: "user-3", Name: "Carol"},
			},
		}},
	})
	var payload messageReactionsUpdatedEventPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		t.Fatalf("unmarshal reaction event: %v", err)
	}
	if len(payload.Reactions) != 1 || len(payload.Reactions[0].Users) != 3 ||
		payload.Reactions[0].Users[2] != (messageReactionUserResponse{ID: "user-3", Name: "Carol"}) {
		t.Fatalf("reaction event payload = %#v", payload)
	}
}
