// Package api exposes the trip store and screenshot extractor over HTTP.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"travelmap/internal/extract"
	"travelmap/internal/store"
	"travelmap/internal/trip"
)

// MaxImageBytes caps uploaded screenshots. Claude accepts images up to 5 MB.
const MaxImageBytes = 5 << 20

var allowedImageTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

type Server struct {
	store     *store.Store
	extractor extract.Extractor
	origins   map[string]bool
	log       *slog.Logger
}

// New builds the HTTP handler. allowedOrigins are the browser origins allowed
// via CORS (e.g. the Next.js dev server).
func New(st *store.Store, ex extract.Extractor, allowedOrigins []string, log *slog.Logger) http.Handler {
	s := &Server{store: st, extractor: ex, origins: map[string]bool{}, log: log}
	for _, o := range allowedOrigins {
		s.origins[strings.TrimRight(o, "/")] = true
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/trips", s.listTrips)
	mux.HandleFunc("POST /api/trips", s.createTrips)
	mux.HandleFunc("PUT /api/trips/{id}", s.updateTrip)
	mux.HandleFunc("DELETE /api/trips/{id}", s.deleteTrip)
	mux.HandleFunc("POST /api/extract", s.extract)
	return s.cors(mux)
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); s.origins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) listTrips(w http.ResponseWriter, r *http.Request) {
	trips, err := s.store.List(r.Context())
	if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, trips)
}

// createTrips accepts {"trips": [...]} so a reviewed batch from /api/extract
// can be saved in one request.
func (s *Server) createTrips(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Trips []trip.Trip `json:"trips"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if len(body.Trips) == 0 {
		writeError(w, http.StatusBadRequest, "trips is empty")
		return
	}
	for i := range body.Trips {
		if err := body.Trips[i].Validate(); err != nil {
			writeError(w, http.StatusBadRequest, "trip "+strconv.Itoa(i)+": "+err.Error())
			return
		}
	}
	created := make([]trip.Trip, 0, len(body.Trips))
	for _, t := range body.Trips {
		c, err := s.store.Create(r.Context(), t)
		if err != nil {
			s.serverError(w, err)
			return
		}
		created = append(created, c)
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateTrip(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var t trip.Trip
	if !decodeJSON(w, r, &t) {
		return
	}
	if err := t.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	t.ID = id
	updated, err := s.store.Update(r.Context(), t)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) deleteTrip(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	err := s.store.Delete(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		s.serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// extract reads a multipart "image" field and returns the recognised trips
// without saving them, so the user can review and correct them first.
func (s *Server) extract(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxImageBytes+1<<20)
	file, _, err := r.FormFile("image")
	if err != nil {
		writeError(w, http.StatusBadRequest, "multipart field \"image\" is required (max 5 MB)")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, MaxImageBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read image")
		return
	}
	if len(data) > MaxImageBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "image must be 5 MB or smaller")
		return
	}
	// Sniff the content instead of trusting the client-supplied header.
	mediaType := http.DetectContentType(data)
	if !allowedImageTypes[mediaType] {
		writeError(w, http.StatusUnsupportedMediaType, "image must be JPEG, PNG, GIF or WebP")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	trips, err := s.extractor.Extract(ctx, data, mediaType)
	switch {
	case errors.Is(err, extract.ErrRefused):
		writeError(w, http.StatusUnprocessableEntity, "the image could not be processed")
		return
	case err != nil:
		s.log.Error("extract failed", "err", err)
		writeError(w, http.StatusBadGateway, "recognition failed, please try again")
		return
	}

	// Report per-trip validation problems instead of dropping trips, so the
	// UI can ask the user to fix them.
	type item struct {
		Trip  trip.Trip `json:"trip"`
		Error string    `json:"error,omitempty"`
	}
	items := make([]item, len(trips))
	for i, t := range trips {
		if err := t.Validate(); err != nil {
			items[i].Error = err.Error()
		}
		items[i].Trip = t
	}
	writeJSON(w, http.StatusOK, map[string]any{"trips": items})
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return 0, false
	}
	return id, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return false
	}
	return true
}

func (s *Server) serverError(w http.ResponseWriter, err error) {
	s.log.Error("request failed", "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
