package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"goddess-server/internal/config"

	"github.com/gorilla/websocket"
)

func TestHealthz(t *testing.T) {
	server := httptest.NewServer(New(testConfig()).Handler())
	defer server.Close()

	resp, err := server.Client().Get(server.URL + "/healthz")
	if err != nil {
		t.Fatalf("get healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}

func TestWebSocketRequiresAuthorization(t *testing.T) {
	server := httptest.NewServer(New(testConfig()).Handler())
	defer server.Close()

	_, resp, err := websocket.DefaultDialer.Dial(wsURL(server.URL)+"/ws", nil)
	if err == nil {
		t.Fatal("Dial() error = nil, want unauthorized error")
	}
	if resp == nil {
		t.Fatal("Dial() response = nil")
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestWebSocketAcceptsAuthorizedConnection(t *testing.T) {
	server := httptest.NewServer(New(testConfig()).Handler())
	defer server.Close()

	header := http.Header{}
	header.Set("Authorization", "Bearer test-secret")
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL(server.URL)+"/ws", header)
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("Dial() error = %v, status = %d", err, status)
	}
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"noop"}`)); err != nil {
		t.Fatalf("WriteMessage() error = %v", err)
	}
}

func testConfig() config.Config {
	return config.Config{
		Addr:      ":20090",
		AppSecret: "test-secret",
	}
}

func wsURL(value string) string {
	return "ws" + strings.TrimPrefix(value, "http")
}
