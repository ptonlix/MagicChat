package conversation

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"app/internal/config"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestListIncludesLastMessageSenders(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 7, 21, 8, 0, 0, 0, time.UTC)
	user := insertConversationTestUser(t, db, "sender@example.com", "Alice", now)
	if err := db.Model(&store.User{}).Where("id = ?", user.ID).Update("nickname", "小艾").Error; err != nil {
		t.Fatalf("set user nickname: %v", err)
	}
	app := store.App{
		ID: uuid.NewString(), Name: "发布助手", Enabled: true,
		Visibility: store.AppVisibilityPublic, ConnectionSecret: uuid.NewString(),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&app).Error; err != nil {
		t.Fatalf("create app: %v", err)
	}

	userConversation := insertLastMessageSenderConversation(t, db, user, now, store.MessageSenderTypeUser, &user.ID)
	appConversation := insertLastMessageSenderConversation(t, db, user, now.Add(-time.Minute), store.MessageSenderTypeApp, &app.ID)
	systemConversation := insertLastMessageSenderConversation(t, db, user, now.Add(-2*time.Minute), store.MessageSenderTypeSystem, nil)
	emptyConversation := insertLastMessageSenderConversation(t, db, user, now.Add(-3*time.Minute), "", nil)
	if err := db.Delete(&app).Error; err != nil {
		t.Fatalf("soft delete app: %v", err)
	}

	service := NewService(Dependencies{
		Apps: config.AppsConfig{AIAssistantSecret: "assistant-secret"}, DB: db,
		Now: func() time.Time { return now },
	})
	listed, err := service.List(context.Background(), ListCommand{AccountID: user.ID})
	if err != nil {
		t.Fatalf("list conversations: %v", err)
	}

	userSender := requireListedLastMessageSender(t, listed.Conversations, userConversation.ID)
	if userSender.Type != store.MessageSenderTypeUser || userSender.ID != user.ID || userSender.Name != "Alice" || userSender.Nickname != "小艾" {
		t.Fatalf("user sender = %#v", userSender)
	}
	appSender := requireListedLastMessageSender(t, listed.Conversations, appConversation.ID)
	if appSender.Type != store.MessageSenderTypeApp || appSender.ID != app.ID || appSender.Name != app.Name || appSender.Nickname != "" {
		t.Fatalf("app sender = %#v", appSender)
	}
	systemSender := requireListedLastMessageSender(t, listed.Conversations, systemConversation.ID)
	if systemSender.Type != store.MessageSenderTypeSystem || systemSender.ID != "" || systemSender.Name != "系统" {
		t.Fatalf("system sender = %#v", systemSender)
	}
	if item := findListedConversation(listed.Conversations, emptyConversation.ID); item == nil || item.LastMessageSender != nil {
		t.Fatalf("empty conversation = %#v, want nil sender", item)
	}
}

func insertLastMessageSenderConversation(t *testing.T, db *gorm.DB, owner store.User, createdAt time.Time, senderType string, senderID *string) store.Conversation {
	t.Helper()
	conversation := store.Conversation{
		ID: uuid.NewString(), Kind: store.ConversationKindGroup, Name: "Sender test",
		CreatedByUserID: owner.ID, Status: store.ConversationStatusActive,
		PostingPolicy: store.ConversationPostingPolicyOpen, Visibility: store.ConversationVisibilityPrivate,
		CreatedAt: createdAt, UpdatedAt: createdAt,
	}
	if senderType != "" {
		message := store.Message{
			ID: uuid.NewString(), ConversationID: conversation.ID, Seq: 1,
			SenderType: senderType, SenderID: senderID,
			Body: json.RawMessage(`{"type":"text","content":"hello"}`), Summary: "hello",
			CreatedAt: createdAt, UpdatedAt: createdAt,
		}
		conversation.LastMessageAt = &message.CreatedAt
		conversation.LastMessageID = &message.ID
		conversation.LastMessageSeq = message.Seq
		conversation.LastMessageSummary = message.Summary
		if err := db.Create(&conversation).Error; err != nil {
			t.Fatalf("create conversation: %v", err)
		}
		if err := db.Create(&message).Error; err != nil {
			t.Fatalf("create message: %v", err)
		}
	} else if err := db.Create(&conversation).Error; err != nil {
		t.Fatalf("create empty conversation: %v", err)
	}
	member := store.ConversationMember{
		ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser,
		MemberID: owner.ID, Role: store.ConversationMemberRoleOwner,
		JoinedAt: createdAt, HistoryVisibleFromSeq: 1,
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
	return conversation
}

func requireListedLastMessageSender(t *testing.T, items []Item, conversationID string) *LastMessageSender {
	t.Helper()
	item := findListedConversation(items, conversationID)
	if item == nil || item.LastMessageSender == nil {
		t.Fatalf("conversation %s sender missing in %#v", conversationID, item)
	}
	return item.LastMessageSender
}

func findListedConversation(items []Item, conversationID string) *Item {
	for index := range items {
		if items[index].ID == conversationID {
			return &items[index]
		}
	}
	return nil
}
