package httpserver

import (
	"net/http"
	"strings"

	"goddess-server/internal/config"
)

type Server struct {
	cfg config.Config
	mux *http.ServeMux
}

func New(cfg config.Config) *Server {
	server := &Server{
		cfg: cfg,
		mux: http.NewServeMux(),
	}
	server.routes()

	return server
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) routes() {
	s.mux.HandleFunc("/healthz", s.healthz)
	s.mux.HandleFunc("/ws", s.websocket)
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("ok\n"))
}

func (s *Server) authenticated(r *http.Request) bool {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	return auth == "Bearer "+s.cfg.AppSecret
}
