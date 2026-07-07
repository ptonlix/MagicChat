package objectstore

import (
	"context"
	"errors"
	"io"
	"net/url"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func (c *Client) PutPublicObject(ctx context.Context, key string, body io.Reader, sizeBytes int64, contentType string) error {
	key = strings.Trim(strings.TrimSpace(key), "/")
	if key == "" {
		return errors.New("public object key is required")
	}
	if sizeBytes < 0 {
		return errors.New("public object size must be non-negative")
	}

	input := &s3.PutObjectInput{
		Bucket:        aws.String(c.cfg.Buckets.Public),
		Key:           aws.String(key),
		Body:          body,
		CacheControl:  aws.String("public, max-age=31536000, immutable"),
		ContentLength: aws.Int64(sizeBytes),
	}
	if contentType = strings.TrimSpace(contentType); contentType != "" {
		input.ContentType = aws.String(contentType)
	}

	_, err := c.s3.PutObject(ctx, input)
	return err
}

func (c *Client) PublicObjectURL(key string) (string, error) {
	key = strings.Trim(strings.TrimSpace(key), "/")
	if key == "" {
		return "", errors.New("public object key is required")
	}
	if strings.TrimSpace(c.cfg.AssetsHostname) == "" {
		return "", errors.New("assets hostname is required")
	}
	if strings.TrimSpace(c.cfg.Buckets.Public) == "" {
		return "", errors.New("public bucket is required")
	}

	return (&url.URL{
		Scheme: "https",
		Host:   strings.TrimSpace(c.cfg.AssetsHostname),
		Path:   "/" + strings.Trim(strings.TrimSpace(c.cfg.Buckets.Public), "/") + "/" + key,
	}).String(), nil
}
