package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"travelmap/internal/api"
	"travelmap/internal/extract"
	"travelmap/internal/store"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// loadDotEnv sets KEY=VALUE pairs from path into the environment, without
// overriding variables that are already set. A missing file is not an error.
func loadDotEnv(path string) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, strings.Trim(strings.TrimSpace(value), `"'`))
		}
	}
	return nil
}

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	if err := loadDotEnv(".env"); err != nil {
		log.Error("read .env", "err", err)
		os.Exit(1)
	}

	addr := getenv("ADDR", "127.0.0.1:8080")
	dbPath := getenv("DB_PATH", "travelmap.db")
	model := getenv("CLAUDE_MODEL", "claude-opus-5")
	origins := strings.Split(getenv("ALLOWED_ORIGINS", "http://localhost:3000"), ",")

	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		log.Warn("ANTHROPIC_API_KEY is not set; screenshot recognition will fail")
	}

	st, err := store.Open(dbPath)
	if err != nil {
		log.Error("open database", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	srv := &http.Server{
		Addr:              addr,
		Handler:           api.New(st, extract.NewClaude("", model), origins, log),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Info("listening", "addr", addr, "model", model, "db", dbPath)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("server stopped", "err", err)
		os.Exit(1)
	}
}
