package httpserver

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"app/internal/store"
)

func TestClientCanUploadCurrentUserAvatar(t *testing.T) {
	s3Server, uploadedObjects := newFakeS3Server(t)
	defer s3Server.Close()

	server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	user := insertTestUser(t, db, "alice@example.com", "Alice", store.UserStatusActive, time.Now().UTC())
	userCookie := loginAsUser(t, server, user.Email)
	avatarContent := testWebPVP8X(256, 256)

	resp, body := postMultipartFileBytes(t, server, "/api/client/me/avatar", "file", "avatar.webp", avatarContent, userCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("upload avatar status = %d, want 200: %#v", resp.StatusCode, body)
	}
	data := requireSuccess(t, body)

	currentUser := data["user"].(map[string]any)
	avatarURL := currentUser["avatar"].(string)
	if !strings.HasPrefix(avatarURL, "https://assets.example.test/mygod-public/avatars/users/"+user.ID+"/") || !strings.HasSuffix(avatarURL, ".webp") {
		t.Fatalf("avatar URL = %q, want public avatar URL", avatarURL)
	}

	var storedUser store.User
	if err := db.First(&storedUser, "id = ?", user.ID).Error; err != nil {
		t.Fatalf("find user: %v", err)
	}
	if storedUser.Avatar != avatarURL {
		t.Fatalf("stored avatar = %q, want %q", storedUser.Avatar, avatarURL)
	}

	uploadedObjects.mu.Lock()
	uploadedBody := uploadedObjects.objects[strings.TrimPrefix(avatarURL, "https://assets.example.test")]
	uploadedObjects.mu.Unlock()
	if !bytes.Equal(uploadedBody, avatarContent) {
		t.Fatalf("uploaded object body = %#v, want avatar content", uploadedBody)
	}
}

func TestUploadCurrentUserAvatarRejectsNonWebP(t *testing.T) {
	s3Server, _ := newFakeS3Server(t)
	defer s3Server.Close()

	server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	user := insertTestUser(t, db, "alice@example.com", "Alice", store.UserStatusActive, time.Now().UTC())
	userCookie := loginAsUser(t, server, user.Email)

	resp, body := postMultipartFileBytes(t, server, "/api/client/me/avatar", "file", "avatar.txt", []byte("not a webp"), userCookie)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("upload avatar status = %d, want 400: %#v", resp.StatusCode, body)
	}
	requireError(t, body, "invalid_request")
}

func TestUploadCurrentUserAvatarRejectsWrongDimensions(t *testing.T) {
	s3Server, _ := newFakeS3Server(t)
	defer s3Server.Close()

	server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	user := insertTestUser(t, db, "alice@example.com", "Alice", store.UserStatusActive, time.Now().UTC())
	userCookie := loginAsUser(t, server, user.Email)

	resp, body := postMultipartFileBytes(t, server, "/api/client/me/avatar", "file", "avatar.webp", testWebPVP8X(128, 128), userCookie)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("upload avatar status = %d, want 400: %#v", resp.StatusCode, body)
	}
	requireError(t, body, "invalid_request")
}

func TestUploadCurrentUserAvatarRequiresLogin(t *testing.T) {
	s3Server, _ := newFakeS3Server(t)
	defer s3Server.Close()

	server, _ := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	resp, body := postMultipartFileBytes(t, server, "/api/client/me/avatar", "file", "avatar.webp", testWebPVP8X(256, 256))
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("upload avatar status = %d, want 401: %#v", resp.StatusCode, body)
	}
	requireError(t, body, "unauthorized")
}

func postMultipartFileBytes(t *testing.T, server *httptest.Server, path string, fieldName string, filename string, content []byte, cookies ...*http.Cookie) (*http.Response, map[string]any) {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile(fieldName, filename)
	if err != nil {
		t.Fatalf("create multipart file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write multipart file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, server.URL+path, &body)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}

	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	t.Cleanup(func() {
		_ = resp.Body.Close()
	})

	var decoded map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	return resp, decoded
}

func testWebPVP8X(width int, height int) []byte {
	content := make([]byte, 30)
	copy(content[0:4], "RIFF")
	binary.LittleEndian.PutUint32(content[4:8], uint32(len(content)-8))
	copy(content[8:12], "WEBP")
	copy(content[12:16], "VP8X")
	binary.LittleEndian.PutUint32(content[16:20], 10)

	widthMinusOne := width - 1
	heightMinusOne := height - 1
	content[24] = byte(widthMinusOne)
	content[25] = byte(widthMinusOne >> 8)
	content[26] = byte(widthMinusOne >> 16)
	content[27] = byte(heightMinusOne)
	content[28] = byte(heightMinusOne >> 8)
	content[29] = byte(heightMinusOne >> 16)

	return content
}
