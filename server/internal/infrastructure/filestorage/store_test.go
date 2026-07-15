package filestorage

import (
	"context"
	"sync"
	"testing"

	"app/internal/config"
	"app/internal/objectstore"
)

func TestStoreReusesObjectStoreClientAcrossConcurrentCalls(t *testing.T) {
	storage := New(config.StorageConfig{
		Provider:        "s3",
		Region:          "us-east-1",
		AccessKeyID:     "test-access-key",
		SecretAccessKey: "test-secret-key",
	}).(*Store)

	const callers = 100
	clients := make(chan *objectstore.Client, callers)
	errors := make(chan error, callers)
	var wait sync.WaitGroup
	for range callers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			client, err := storage.client(context.Background())
			if err != nil {
				errors <- err
				return
			}
			clients <- client
		}()
	}
	wait.Wait()
	close(clients)
	close(errors)

	for err := range errors {
		t.Fatalf("initialize object store client: %v", err)
	}
	var first *objectstore.Client
	count := 0
	for client := range clients {
		count++
		if first == nil {
			first = client
			continue
		}
		if client != first {
			t.Fatal("object store client was initialized more than once")
		}
	}
	if count != callers {
		t.Fatalf("clients = %d, want %d", count, callers)
	}
}
