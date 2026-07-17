package store

import (
	"bytes"
	"context"
	"errors"
	"log"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
)

func TestDatabaseLoggerSuppressesOnlyRecordNotFound(t *testing.T) {
	var output bytes.Buffer
	logger := newDatabaseLogger(log.New(&output, "", 0))
	trace := func() (string, int64) { return "SELECT 1", 0 }

	logger.Trace(context.Background(), time.Now(), trace, gorm.ErrRecordNotFound)
	if output.Len() != 0 {
		t.Fatalf("record-not-found log = %q", output.String())
	}

	logger.Trace(context.Background(), time.Now(), trace, errors.New("database unavailable"))
	if !strings.Contains(output.String(), "database unavailable") {
		t.Fatalf("database error log = %q", output.String())
	}
}
