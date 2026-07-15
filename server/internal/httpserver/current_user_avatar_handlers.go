package httpserver

import (
	"errors"
	"io"

	"app/internal/media"
)

const (
	avatarContentType     = "image/webp"
	avatarOutputSize      = 256
	maxAvatarUploadBytes  = 1 * 1024 * 1024
	maxAvatarRequestBytes = maxAvatarUploadBytes + 1*1024*1024
)

var errAvatarTooLarge = errors.New("avatar too large")

func readAvatarUpload(reader io.Reader) ([]byte, error) {
	content, err := io.ReadAll(io.LimitReader(reader, maxAvatarUploadBytes+1))
	if err != nil {
		return nil, err
	}
	if len(content) > maxAvatarUploadBytes {
		return nil, errAvatarTooLarge
	}
	if len(content) == 0 {
		return nil, errors.New("empty avatar")
	}

	return content, nil
}

func validateAvatarUpload(content []byte) error {
	width, height, err := parseWebPDimensions(content)
	if err != nil {
		return err
	}
	if width != avatarOutputSize || height != avatarOutputSize {
		return errors.New("invalid avatar dimensions")
	}

	return nil
}

func parseWebPDimensions(content []byte) (int, int, error) {
	return media.WebPDimensions(content)
}
