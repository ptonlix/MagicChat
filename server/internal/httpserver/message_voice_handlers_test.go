package httpserver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strconv"
	"strings"
	"testing"
	"time"

	"app/internal/realtime"
	"app/internal/store"
)

func TestClientCanSendConversationVoiceMessage(t *testing.T) {
	s3Server, uploadedObjects := newFakeS3Server(t)
	defer s3Server.Close()

	server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	now := time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC)
	alice := insertTestUser(t, db, "voice-alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "voice-bob@example.com", "Bob", store.UserStatusActive, now)
	conversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		memberIDs:       []string{alice.ID, bob.ID},
		now:             now,
	})

	bobCookie := loginAsUser(t, server, bob.Email)
	bobConn := dialClientWebSocket(t, server, bobCookie)
	if ready := readRealtimeEvent(t, bobConn); ready.Kind != realtime.KindEvent || ready.Event != realtime.EventSystemReady {
		t.Fatalf("ready envelope = %#v, want system.ready event", ready)
	}

	voice := testWebMOpusVoice()
	resp, body := postMultipartVoiceMessage(
		t,
		server,
		"/api/client/conversations/"+conversation.ID+"/messages/voices",
		"client-voice-message-1",
		42_800,
		voiceMessageContentType,
		voice,
		loginAsUser(t, server, alice.Email),
	)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("send voice message status = %d, want 201: %#v", resp.StatusCode, body)
	}

	message := requireSuccess(t, body)["message"].(map[string]any)
	messageBody := message["body"].(map[string]any)
	if messageBody["type"] != messageTypeVoice {
		t.Fatalf("message.body.type = %v, want voice", messageBody["type"])
	}
	fileID := messageBody["file_id"].(string)
	if messageBody["duration_ms"] != float64(42_800) {
		t.Fatalf("message.body.duration_ms = %v, want 42800", messageBody["duration_ms"])
	}
	if messageBody["size_bytes"] != float64(len(voice)) {
		t.Fatalf("message.body.size_bytes = %v, want %d", messageBody["size_bytes"], len(voice))
	}
	if messageBody["content_type"] != voiceMessageContentType {
		t.Fatalf("message.body.content_type = %v, want %s", messageBody["content_type"], voiceMessageContentType)
	}
	if messageBody["transcript"] != voiceMessageDemoTranscript {
		t.Fatalf("message.body.transcript = %v, want %s", messageBody["transcript"], voiceMessageDemoTranscript)
	}
	var storedFile store.TemporaryFile
	if err := db.First(&storedFile, "id = ?", fileID).Error; err != nil {
		t.Fatalf("find temporary file: %v", err)
	}
	if storedFile.SizeBytes != int64(len(voice)) {
		t.Fatalf("stored file size = %d, want %d", storedFile.SizeBytes, len(voice))
	}
	if !strings.HasPrefix(storedFile.ObjectKey, "temporary-files/") {
		t.Fatalf("stored object key = %q, want temporary-files prefix", storedFile.ObjectKey)
	}
	uploadedObjects.mu.Lock()
	uploadedBody := uploadedObjects.objects["/mygod-temporary/"+storedFile.ObjectKey]
	uploadedObjects.mu.Unlock()
	if !bytes.Equal(uploadedBody, voice) {
		t.Fatalf("uploaded voice = %#v, want %#v", uploadedBody, voice)
	}
	var storedMessage store.Message
	if err := db.First(&storedMessage, "id = ?", message["id"]).Error; err != nil {
		t.Fatalf("find stored message: %v", err)
	}
	expectedSummary := "[语音] 00:43 - " + voiceMessageDemoTranscript
	if storedMessage.Summary != expectedSummary {
		t.Fatalf("stored message summary = %q, want %q", storedMessage.Summary, expectedSummary)
	}
	var storedConversation store.Conversation
	if err := db.First(&storedConversation, "id = ?", conversation.ID).Error; err != nil {
		t.Fatalf("find stored conversation: %v", err)
	}
	if storedConversation.LastMessageSummary != expectedSummary {
		t.Fatalf("conversation summary = %q, want %q", storedConversation.LastMessageSummary, expectedSummary)
	}

	pushedBody := readMessageCreatedEvent(t, bobConn)["body"].(map[string]any)
	if pushedBody["type"] != messageTypeVoice ||
		pushedBody["file_id"] != fileID ||
		pushedBody["duration_ms"] != float64(42_800) ||
		pushedBody["transcript"] != voiceMessageDemoTranscript {
		t.Fatalf("pushed voice body = %#v", pushedBody)
	}
}

func TestCreateConversationVoiceMessageValidatesUpload(t *testing.T) {
	tests := []struct {
		content     []byte
		contentType string
		durationMS  int
		name        string
		status      int
	}{
		{
			content:     testWebMOpusVoice(),
			contentType: voiceMessageContentType,
			durationMS:  maxVoiceMessageDurationMS + 1,
			name:        "duration over limit",
			status:      http.StatusBadRequest,
		},
		{
			content:     []byte("not webm opus"),
			contentType: voiceMessageContentType,
			durationMS:  1_000,
			name:        "invalid webm",
			status:      http.StatusBadRequest,
		},
		{
			content:     testWebMOpusVoice(),
			contentType: "audio/mpeg",
			durationMS:  1_000,
			name:        "invalid content type",
			status:      http.StatusBadRequest,
		},
		{
			content: append(
				testWebMOpusVoice(),
				make([]byte, maxVoiceMessageUploadBytes)...,
			),
			contentType: voiceMessageContentType,
			durationMS:  60_000,
			name:        "file over limit",
			status:      http.StatusRequestEntityTooLarge,
		},
	}

	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			s3Server, _ := newFakeS3Server(t)
			defer s3Server.Close()
			server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
			defer server.Close()

			now := time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC)
			alice := insertTestUser(t, db, fmt.Sprintf("voice-validation-%d@example.com", index), "Alice", store.UserStatusActive, now)
			conversation := insertTestConversation(t, db, testConversationInput{
				createdByUserID: alice.ID,
				kind:            store.ConversationKindDirect,
				memberIDs:       []string{alice.ID},
				now:             now,
			})

			resp, body := postMultipartVoiceMessage(
				t,
				server,
				"/api/client/conversations/"+conversation.ID+"/messages/voices",
				"client-voice-validation",
				test.durationMS,
				test.contentType,
				test.content,
				loginAsUser(t, server, alice.Email),
			)
			if resp.StatusCode != test.status {
				t.Fatalf("status = %d, want %d: %#v", resp.StatusCode, test.status, body)
			}
		})
	}
}

func TestCreateConversationVoiceMessageIsIdempotent(t *testing.T) {
	s3Server, _ := newFakeS3Server(t)
	defer s3Server.Close()
	server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	now := time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC)
	alice := insertTestUser(t, db, "voice-idempotent@example.com", "Alice", store.UserStatusActive, now)
	conversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID,
		kind:            store.ConversationKindDirect,
		memberIDs:       []string{alice.ID},
		now:             now,
	})
	cookie := loginAsUser(t, server, alice.Email)
	path := "/api/client/conversations/" + conversation.ID + "/messages/voices"
	voice := testWebMOpusVoice()

	firstResp, firstBody := postMultipartVoiceMessage(t, server, path, "same-voice-message", 2_500, voiceMessageContentType, voice, cookie)
	secondResp, secondBody := postMultipartVoiceMessage(t, server, path, "same-voice-message", 2_500, voiceMessageContentType, voice, cookie)
	if firstResp.StatusCode != http.StatusCreated || secondResp.StatusCode != http.StatusOK {
		t.Fatalf("statuses = %d/%d, want 201/200", firstResp.StatusCode, secondResp.StatusCode)
	}
	firstMessage := requireSuccess(t, firstBody)["message"].(map[string]any)
	secondMessage := requireSuccess(t, secondBody)["message"].(map[string]any)
	if firstMessage["id"] != secondMessage["id"] {
		t.Fatalf("message ids = %v/%v, want equal", firstMessage["id"], secondMessage["id"])
	}

	var temporaryFileCount int64
	if err := db.Model(&store.TemporaryFile{}).Count(&temporaryFileCount).Error; err != nil {
		t.Fatalf("count temporary files: %v", err)
	}
	if temporaryFileCount != 1 {
		t.Fatalf("temporary file count = %d, want 1", temporaryFileCount)
	}
}

func postMultipartVoiceMessage(
	t *testing.T,
	server *httptest.Server,
	path string,
	clientMessageID string,
	durationMS int,
	contentType string,
	content []byte,
	cookie *http.Cookie,
) (*http.Response, map[string]any) {
	t.Helper()

	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	if err := writer.WriteField("client_message_id", clientMessageID); err != nil {
		t.Fatalf("write client message id: %v", err)
	}
	if err := writer.WriteField("duration_ms", strconv.Itoa(durationMS)); err != nil {
		t.Fatalf("write duration: %v", err)
	}
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="voice"; filename="voice-message.webm"`)
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatalf("create voice part: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write voice content: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	request, err := http.NewRequest(http.MethodPost, server.URL+path, &requestBody)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.AddCookie(cookie)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("send request: %v", err)
	}
	defer response.Body.Close()

	var responseBody map[string]any
	if err := json.NewDecoder(response.Body).Decode(&responseBody); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	return response, responseBody
}

func testWebMOpusVoice() []byte {
	return append(
		append(
			append([]byte{}, webMHeader...),
			[]byte("\x9fB\x86\x81\x01B\xf7\x81\x01B\xf2\x81\x04B\xf3\x81\x08B\x82\x84webmA_OPUS")...,
		),
		[]byte("OpusHead\x01\x01\x00\x00\x80\xbb\x00\x00\x00\x00\x00")...,
	)
}
