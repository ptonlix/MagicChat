package client

import (
	"testing"

	conversationapp "app/internal/application/conversation"
)

func TestNewConversationItemResponseIncludesLastMessageSender(t *testing.T) {
	response := newConversationItemResponse(conversationapp.Item{
		LastMessageSender: &conversationapp.LastMessageSender{
			ID: "user-id", Name: "Alice", Nickname: "小艾", Type: "user",
		},
	})
	if response.LastMessageSender == nil {
		t.Fatal("last message sender is nil")
	}
	if response.LastMessageSender.ID != "user-id" || response.LastMessageSender.Name != "Alice" || response.LastMessageSender.Nickname != "小艾" || response.LastMessageSender.Type != "user" {
		t.Fatalf("last message sender = %#v", response.LastMessageSender)
	}

	empty := newConversationItemResponse(conversationapp.Item{})
	if empty.LastMessageSender != nil {
		t.Fatalf("empty last message sender = %#v, want nil", empty.LastMessageSender)
	}
}

func TestNewGroupResponseIncludesLastMessageSender(t *testing.T) {
	response := newGroupResponse(conversationapp.Group{
		LastMessageSender: &conversationapp.LastMessageSender{
			Name: "系统", Type: "system",
		},
	})
	if response.LastMessageSender == nil || response.LastMessageSender.Name != "系统" || response.LastMessageSender.Type != "system" {
		t.Fatalf("last message sender = %#v", response.LastMessageSender)
	}
}
