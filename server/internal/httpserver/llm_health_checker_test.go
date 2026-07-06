package httpserver

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTruncateLLMHealthErrorKeepsValidUTF8(t *testing.T) {
	message := strings.Repeat("错误", 300)

	truncated := truncateLLMHealthError(message)

	if !utf8.ValidString(truncated) {
		t.Fatalf("truncated message is not valid UTF-8")
	}
	if len(truncated) > 1000 {
		t.Fatalf("truncated message length = %d, want <= 1000", len(truncated))
	}
	if truncated == "" || truncated == message {
		t.Fatalf("truncated message = %q, want non-empty truncated value", truncated)
	}
}
