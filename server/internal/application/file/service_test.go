package file

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestServiceUploadsTemporaryFileAndResolvesURL(t *testing.T) {
	db := openFileTestDB(t)
	now := time.Date(2026, 7, 15, 6, 30, 0, 0, time.UTC)
	fileID := uuid.NewString()
	storage := &recordingBlobStorage{}
	service := NewService(Dependencies{
		DB:                  db,
		Storage:             storage,
		Now:                 func() time.Time { return now },
		NewID:               func() string { return fileID },
		TemporaryExpireDays: 180,
	})

	value, err := service.UploadTemporary(context.Background(), UploadTemporaryCommand{
		Content:     strings.NewReader("temporary content"),
		ContentType: "text/plain",
		SizeBytes:   int64(len("temporary content")),
	})
	if err != nil {
		t.Fatalf("upload temporary file: %v", err)
	}
	if value.ID != fileID || value.CreatedAt != now || !strings.HasPrefix(value.ObjectKey, "temporary-files/2026/07/15/") {
		t.Fatalf("temporary file = %#v", value)
	}
	if string(storage.temporaryContent) != "temporary content" || storage.temporaryContentType != "text/plain" {
		t.Fatalf("temporary upload = %q, type = %q", storage.temporaryContent, storage.temporaryContentType)
	}

	var stored store.TemporaryFile
	if err := db.First(&stored, "id = ?", fileID).Error; err != nil {
		t.Fatalf("load stored temporary file: %v", err)
	}
	if stored.ObjectKey != value.ObjectKey || stored.SizeBytes != value.SizeBytes {
		t.Fatalf("stored temporary file = %#v", stored)
	}

	resolved, err := service.ResolveTemporaryURL(context.Background(), fileID)
	if err != nil {
		t.Fatalf("resolve temporary URL: %v", err)
	}
	if resolved.FileID != fileID || resolved.URL != "https://assets.example.test/temporary/"+value.ObjectKey {
		t.Fatalf("resolved URL = %#v", resolved)
	}
}

func TestServiceRejectsMissingAndExpiredTemporaryFiles(t *testing.T) {
	db := openFileTestDB(t)
	now := time.Date(2026, 7, 15, 6, 30, 0, 0, time.UTC)
	service := NewService(Dependencies{
		DB:                  db,
		Storage:             &recordingBlobStorage{},
		Now:                 func() time.Time { return now },
		TemporaryExpireDays: 30,
	})

	missingID := uuid.NewString()
	if _, err := service.ResolveTemporaryURL(context.Background(), missingID); ErrorCodeOf(err) != CodeNotFound {
		t.Fatalf("missing error = %v, code = %q", err, ErrorCodeOf(err))
	}

	expired := store.TemporaryFile{
		ID:        uuid.NewString(),
		ObjectKey: "temporary-files/expired",
		SizeBytes: 1,
		CreatedAt: now.AddDate(0, 0, -30),
	}
	if err := db.Create(&expired).Error; err != nil {
		t.Fatalf("create expired file: %v", err)
	}
	if err := service.ValidateTemporaryFiles(context.Background(), []string{expired.ID}); ErrorCodeOf(err) != CodeNotFound {
		t.Fatalf("expired error = %v, code = %q", err, ErrorCodeOf(err))
	}

	if _, err := service.ResolveTemporaryURLs(context.Background(), []string{"invalid"}); ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("invalid ID error = %v, code = %q", err, ErrorCodeOf(err))
	}
}

func TestServiceUploadsPublicFileWithoutDatabaseRecord(t *testing.T) {
	storage := &recordingBlobStorage{}
	service := NewService(Dependencies{Storage: storage})
	content := []byte("avatar")
	value, err := service.UploadPublic(context.Background(), UploadPublicCommand{
		ObjectKey:   "/avatars/users/user-1/avatar.webp/",
		Content:     bytes.NewReader(content),
		ContentType: "image/webp",
		SizeBytes:   int64(len(content)),
	})
	if err != nil {
		t.Fatalf("upload public file: %v", err)
	}
	if value.ObjectKey != "avatars/users/user-1/avatar.webp" || value.URL != storage.publicURL {
		t.Fatalf("public file = %#v", value)
	}
	if !bytes.Equal(storage.publicContent, content) || storage.publicContentType != "image/webp" {
		t.Fatalf("public upload = %q, type = %q", storage.publicContent, storage.publicContentType)
	}
}

type recordingBlobStorage struct {
	publicContent        []byte
	publicContentType    string
	publicURL            string
	temporaryContent     []byte
	temporaryContentType string
}

func (s *recordingBlobStorage) PutPublic(_ context.Context, key string, content io.Reader, _ int64, contentType string) (string, error) {
	s.publicContent, _ = io.ReadAll(content)
	s.publicContentType = contentType
	s.publicURL = "https://assets.example.test/public/" + key
	return s.publicURL, nil
}

func (s *recordingBlobStorage) PutTemporary(_ context.Context, _ string, content io.Reader, _ int64, contentType string) error {
	s.temporaryContent, _ = io.ReadAll(content)
	s.temporaryContentType = contentType
	return nil
}

func (s *recordingBlobStorage) PresignTemporaryReadURL(_ context.Context, key string) (string, time.Time, error) {
	return "https://assets.example.test/temporary/" + key, time.Date(2026, 7, 16, 6, 30, 0, 0, time.UTC), nil
}

func openFileTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&store.TemporaryFile{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	return db
}
