package httpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"app/internal/store"
)

func TestGroupOwnerCanUploadConversationAvatar(t *testing.T) {
	s3Server, uploadedObjects := newFakeS3Server(t)
	defer s3Server.Close()

	server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	now := time.Date(2026, 7, 7, 9, 0, 0, 0, time.UTC)
	alice := insertTestUser(t, db, "alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "bob@example.com", "Bob", store.UserStatusActive, now)
	lastMessageAt := now.Add(-time.Hour)
	conversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID:    alice.ID,
		kind:               store.ConversationKindGroup,
		lastMessageAt:      &lastMessageAt,
		lastMessageSeq:     2,
		lastMessageSummary: "旧消息",
		memberIDs:          []string{alice.ID, bob.ID},
		name:               "产品讨论组",
		now:                now.Add(-2 * time.Hour),
	})
	setTestConversationMemberLastReadSeq(t, db, conversation.ID, alice.ID, 2)
	setTestConversationMemberLastReadSeq(t, db, conversation.ID, bob.ID, 1)
	avatarContent := testWebPVP8X(256, 256)

	resp, body := postMultipartFileBytes(
		t,
		server,
		"/api/client/conversations/"+conversation.ID+"/avatar",
		"file",
		"group-avatar.webp",
		avatarContent,
		loginAsUser(t, server, alice.Email),
	)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("upload group avatar status = %d, want 200: %#v", resp.StatusCode, body)
	}
	data := requireSuccess(t, body)
	updatedConversation := data["conversation"].(map[string]any)
	createdMessage := data["message"].(map[string]any)

	avatarURL := updatedConversation["avatar"].(string)
	if !strings.HasPrefix(avatarURL, "https://assets.example.test/mygod-public/avatars/conversations/"+conversation.ID+"/") || !strings.HasSuffix(avatarURL, ".webp") {
		t.Fatalf("conversation.avatar = %q, want public conversation avatar URL", avatarURL)
	}
	if updatedConversation["last_message_seq"] != float64(3) {
		t.Fatalf("conversation.last_message_seq = %v, want 3", updatedConversation["last_message_seq"])
	}
	if updatedConversation["last_message_summary"] != "Alice 修改了群头像" {
		t.Fatalf("conversation.last_message_summary = %v", updatedConversation["last_message_summary"])
	}
	if updatedConversation["last_read_seq"] != float64(3) {
		t.Fatalf("conversation.last_read_seq = %v, want 3", updatedConversation["last_read_seq"])
	}
	if updatedConversation["unread_count"] != float64(0) {
		t.Fatalf("conversation.unread_count = %v, want 0", updatedConversation["unread_count"])
	}

	if createdMessage["conversation_id"] != conversation.ID {
		t.Fatalf("message.conversation_id = %v, want %s", createdMessage["conversation_id"], conversation.ID)
	}
	if createdMessage["seq"] != float64(3) {
		t.Fatalf("message.seq = %v, want 3", createdMessage["seq"])
	}
	sender := createdMessage["sender"].(map[string]any)
	if sender["type"] != store.MessageSenderTypeSystem {
		t.Fatalf("message.sender.type = %v, want system", sender["type"])
	}
	messageBody := createdMessage["body"].(map[string]any)
	if messageBody["type"] != "system_event" {
		t.Fatalf("message.body.type = %v, want system_event", messageBody["type"])
	}
	if messageBody["event"] != "group_avatar_updated" {
		t.Fatalf("message.body.event = %v, want group_avatar_updated", messageBody["event"])
	}
	actor := messageBody["actor"].(map[string]any)
	if actor["id"] != alice.ID || actor["display_name"] != "Alice" {
		t.Fatalf("message.body.actor = %#v, want Alice", actor)
	}

	var storedConversation store.Conversation
	if err := db.First(&storedConversation, "id = ?", conversation.ID).Error; err != nil {
		t.Fatalf("find stored conversation: %v", err)
	}
	if storedConversation.Avatar != avatarURL {
		t.Fatalf("stored conversation avatar = %q, want %q", storedConversation.Avatar, avatarURL)
	}
	if storedConversation.LastMessageSummary != "Alice 修改了群头像" {
		t.Fatalf("stored last_message_summary = %q", storedConversation.LastMessageSummary)
	}
	if got := getTestConversationMemberLastReadSeq(t, db, conversation.ID, alice.ID); got != 3 {
		t.Fatalf("alice last_read_seq = %d, want 3", got)
	}
	if got := getTestConversationMemberLastReadSeq(t, db, conversation.ID, bob.ID); got != 1 {
		t.Fatalf("bob last_read_seq = %d, want 1", got)
	}

	var storedMessage store.Message
	if err := db.First(&storedMessage, "id = ?", createdMessage["id"]).Error; err != nil {
		t.Fatalf("find stored system message: %v", err)
	}
	if storedMessage.Summary != "Alice 修改了群头像" {
		t.Fatalf("stored message summary = %q", storedMessage.Summary)
	}
	requireGroupAvatarUpdatedBody(t, storedMessage.Body, alice.ID, "Alice")

	uploadedObjects.mu.Lock()
	uploadedBody := uploadedObjects.objects[strings.TrimPrefix(avatarURL, "https://assets.example.test")]
	uploadedObjects.mu.Unlock()
	if !bytes.Equal(uploadedBody, avatarContent) {
		t.Fatalf("uploaded object body = %#v, want avatar content", uploadedBody)
	}
}

func TestGroupAdminCanUploadConversationAvatar(t *testing.T) {
	s3Server, _ := newFakeS3Server(t)
	defer s3Server.Close()

	server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	now := time.Date(2026, 7, 7, 9, 0, 0, 0, time.UTC)
	alice := insertTestUser(t, db, "alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "bob@example.com", "Bob", store.UserStatusActive, now)
	conversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindGroup,
		memberIDs:       []string{alice.ID, bob.ID},
		name:            "产品讨论组",
		now:             now,
	})
	if err := db.Model(&store.ConversationMember{}).
		Where("conversation_id = ? AND member_type = ? AND member_id = ?", conversation.ID, store.ConversationMemberTypeUser, bob.ID).
		Update("role", store.ConversationMemberRoleAdmin).Error; err != nil {
		t.Fatalf("set admin role: %v", err)
	}

	resp, body := postMultipartFileBytes(
		t,
		server,
		"/api/client/conversations/"+conversation.ID+"/avatar",
		"file",
		"group-avatar.webp",
		testWebPVP8X(256, 256),
		loginAsUser(t, server, bob.Email),
	)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("upload group avatar status = %d, want 200: %#v", resp.StatusCode, body)
	}
	requireSuccess(t, body)
}

func TestGroupMemberCannotUploadConversationAvatar(t *testing.T) {
	s3Server, uploadedObjects := newFakeS3Server(t)
	defer s3Server.Close()

	server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	now := time.Date(2026, 7, 7, 9, 0, 0, 0, time.UTC)
	alice := insertTestUser(t, db, "alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "bob@example.com", "Bob", store.UserStatusActive, now)
	conversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindGroup,
		memberIDs:       []string{alice.ID, bob.ID},
		name:            "产品讨论组",
		now:             now,
	})

	resp, body := postMultipartFileBytes(
		t,
		server,
		"/api/client/conversations/"+conversation.ID+"/avatar",
		"file",
		"group-avatar.webp",
		testWebPVP8X(256, 256),
		loginAsUser(t, server, bob.Email),
	)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("upload group avatar status = %d, want 403: %#v", resp.StatusCode, body)
	}
	requireError(t, body, "forbidden")

	uploadedObjects.mu.Lock()
	defer uploadedObjects.mu.Unlock()
	if len(uploadedObjects.objects) != 0 {
		t.Fatalf("uploaded object count = %d, want 0", len(uploadedObjects.objects))
	}
}

func TestUploadGroupConversationAvatarRejectsDirectConversation(t *testing.T) {
	s3Server, _ := newFakeS3Server(t)
	defer s3Server.Close()

	server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	now := time.Date(2026, 7, 7, 9, 0, 0, 0, time.UTC)
	alice := insertTestUser(t, db, "alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "bob@example.com", "Bob", store.UserStatusActive, now)
	conversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		memberIDs:       []string{alice.ID, bob.ID},
		now:             now,
	})

	resp, body := postMultipartFileBytes(
		t,
		server,
		"/api/client/conversations/"+conversation.ID+"/avatar",
		"file",
		"group-avatar.webp",
		testWebPVP8X(256, 256),
		loginAsUser(t, server, alice.Email),
	)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("upload group avatar status = %d, want 400: %#v", resp.StatusCode, body)
	}
	requireError(t, body, "invalid_request")
}

func requireGroupAvatarUpdatedBody(t *testing.T, raw json.RawMessage, actorID string, actorDisplayName string) {
	t.Helper()

	var body struct {
		Actor struct {
			DisplayName string `json:"display_name"`
			ID          string `json:"id"`
		} `json:"actor"`
		Event string `json:"event"`
		Type  string `json:"type"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal group avatar updated body: %v", err)
	}
	if body.Type != "system_event" {
		t.Fatalf("body.type = %q, want system_event", body.Type)
	}
	if body.Event != "group_avatar_updated" {
		t.Fatalf("body.event = %q, want group_avatar_updated", body.Event)
	}
	if body.Actor.ID != actorID || body.Actor.DisplayName != actorDisplayName {
		t.Fatalf("body.actor = %#v, want %s/%s", body.Actor, actorID, actorDisplayName)
	}
}
