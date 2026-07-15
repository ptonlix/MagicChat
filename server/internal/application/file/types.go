package file

import (
	"context"
	"io"
	"time"
)

const (
	DefaultTemporaryExpireDays = 180
	MaxResolveBatchSize        = 100
	MaxTemporaryUploadBytes    = 20 * 1024 * 1024
)

type TemporaryFile struct {
	ID        string
	ObjectKey string
	SizeBytes int64
	CreatedAt time.Time
}

type PublicFile struct {
	ObjectKey   string
	URL         string
	ContentType string
	SizeBytes   int64
}

type ResolvedTemporaryURL struct {
	FileID    string
	URL       string
	ExpiresAt time.Time
}

type UploadPublicCommand struct {
	ObjectKey   string
	Content     io.Reader
	ContentType string
	SizeBytes   int64
}

type UploadTemporaryCommand struct {
	Content     io.Reader
	ContentType string
	SizeBytes   int64
}

type BlobStorage interface {
	PutPublic(context.Context, string, io.Reader, int64, string) (string, error)
	PutTemporary(context.Context, string, io.Reader, int64, string) error
	PresignTemporaryReadURL(context.Context, string) (string, time.Time, error)
}

type PublicUploader interface {
	UploadPublic(context.Context, UploadPublicCommand) (PublicFile, error)
}

type ClientService interface {
	UploadTemporary(context.Context, UploadTemporaryCommand) (TemporaryFile, error)
	ResolveTemporaryURL(context.Context, string) (ResolvedTemporaryURL, error)
	ResolveTemporaryURLs(context.Context, []string) ([]ResolvedTemporaryURL, error)
}

type TemporaryFileService interface {
	ClientService
	ValidateTemporaryFiles(context.Context, []string) error
}
