package objectstore

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"app/internal/config"
)

func TestPublicObjectURLUsesPublicBucketHostname(t *testing.T) {
	client := &Client{cfg: config.StorageConfig{
		Buckets: config.StorageBucketsConfig{Public: "chat-public-1450770193"},
		AssetHostnames: config.StorageAssetHostnamesConfig{
			Public: "chat-public-1450770193.cos.ap-guangzhou.myqcloud.com",
		},
	}}

	got, err := client.PublicObjectURL("avatars/alice.webp")
	if err != nil {
		t.Fatalf("PublicObjectURL() error = %v", err)
	}
	want := "https://chat-public-1450770193.cos.ap-guangzhou.myqcloud.com/avatars/alice.webp"
	if got != want {
		t.Fatalf("PublicObjectURL() = %q, want %q", got, want)
	}
}

func TestPresignTemporaryReadURLUsesTemporaryBucketHostname(t *testing.T) {
	cfg := config.StorageConfig{
		Provider:        "s3",
		Endpoint:        "https://cos.ap-guangzhou.myqcloud.com",
		Region:          "ap-guangzhou",
		AccessKeyID:     "test-secret-id",
		SecretAccessKey: "test-secret-key",
		ForcePathStyle:  false,
		Buckets: config.StorageBucketsConfig{
			Public:    "chat-public-1450770193",
			Private:   "chat-private-1450770193",
			Temporary: "chat-temporary-1450770193",
		},
		AssetHostnames: config.StorageAssetHostnamesConfig{
			Public:    "chat-public-1450770193.cos.ap-guangzhou.myqcloud.com",
			Private:   "chat-private-1450770193.cos.ap-guangzhou.myqcloud.com",
			Temporary: "chat-temporary-1450770193.cos.ap-guangzhou.myqcloud.com",
		},
	}
	client, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	got, _, err := client.PresignTemporaryReadURL(
		context.Background(),
		"temporary-files/example.webp",
		15*time.Minute,
	)
	if err != nil {
		t.Fatalf("PresignTemporaryReadURL() error = %v", err)
	}
	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("parse presigned URL: %v", err)
	}
	if parsed.Hostname() != cfg.AssetHostnames.Temporary {
		t.Fatalf("presigned hostname = %q, want %q", parsed.Hostname(), cfg.AssetHostnames.Temporary)
	}
	if parsed.Path != "/temporary-files/example.webp" {
		t.Fatalf("presigned path = %q", parsed.Path)
	}
	if strings.TrimSpace(parsed.Query().Get("X-Amz-Signature")) == "" {
		t.Fatalf("presigned URL has no signature: %s", got)
	}
}
