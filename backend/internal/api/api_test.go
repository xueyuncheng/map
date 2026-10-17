package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"travelmap/internal/store"
	"travelmap/internal/trip"
)

type fakeExtractor struct {
	trips     []trip.Trip
	mediaType string
}

func (f *fakeExtractor) Extract(_ context.Context, _ []byte, mediaType string) ([]trip.Trip, error) {
	f.mediaType = mediaType
	return f.trips, nil
}

func setup(t *testing.T, ex *fakeExtractor) http.Handler {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return New(st, ex, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func do(h http.Handler, method, path, contentType string, body io.Reader) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, body)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

var tokyo = trip.Place{Name: "Tokyo", Country: "JP", Lat: 35.68, Lng: 139.69}

func TestExtractValidatesUpload(t *testing.T) {
	ex := &fakeExtractor{trips: []trip.Trip{
		{Type: trip.Hotel, Destination: tokyo, StartDate: "2026-05-01"},
		{Type: "spaceship", Destination: tokyo},
	}}
	h := setup(t, ex)

	upload := func(data []byte) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fw, _ := mw.CreateFormFile("image", "order.png")
		fw.Write(data)
		mw.Close()
		return do(h, "POST", "/api/extract", mw.FormDataContentType(), &buf)
	}

	if rec := upload([]byte("plain text, not an image")); rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("text upload: %d %s", rec.Code, rec.Body)
	}

	rec := upload([]byte("\x89PNG\r\n\x1a\n0000"))
	if rec.Code != http.StatusOK {
		t.Fatalf("png upload: %d %s", rec.Code, rec.Body)
	}
	if ex.mediaType != "image/png" {
		t.Errorf("media type = %q", ex.mediaType)
	}
	var resp struct {
		Trips []struct {
			Trip  trip.Trip `json:"trip"`
			Error string    `json:"error"`
		} `json:"trips"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Trips) != 2 || resp.Trips[0].Error != "" || resp.Trips[1].Error == "" {
		t.Errorf("unexpected extract response: %s", rec.Body)
	}
}

func TestTripLifecycle(t *testing.T) {
	h := setup(t, &fakeExtractor{})

	rec := do(h, "POST", "/api/trips", "application/json", strings.NewReader(
		`{"trips":[{"type":"train","origin":{"name":"Beijing","country":"CN","lat":39.9,"lng":116.4},
		"destination":{"name":"Shanghai","country":"CN","lat":31.23,"lng":121.47},"start_date":"2026-01-02"}]}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	var created []trip.Trip
	json.Unmarshal(rec.Body.Bytes(), &created)
	if len(created) != 1 || created[0].ID == 0 {
		t.Fatalf("created = %+v", created)
	}

	bad := `{"trips":[{"type":"train","destination":{"name":"X","lat":200,"lng":0}}]}`
	if rec := do(h, "POST", "/api/trips", "application/json", strings.NewReader(bad)); rec.Code != http.StatusBadRequest {
		t.Errorf("invalid lat accepted: %d", rec.Code)
	}

	created[0].Notes = "G1"
	body, _ := json.Marshal(created[0])
	if rec := do(h, "PUT", "/api/trips/1", "application/json", bytes.NewReader(body)); rec.Code != http.StatusOK {
		t.Errorf("update: %d %s", rec.Code, rec.Body)
	}

	rec = do(h, "GET", "/api/trips", "", nil)
	if !strings.Contains(rec.Body.String(), `"notes":"G1"`) {
		t.Errorf("list: %s", rec.Body)
	}

	if rec := do(h, "DELETE", "/api/trips/1", "", nil); rec.Code != http.StatusNoContent {
		t.Errorf("delete: %d", rec.Code)
	}
	if rec := do(h, "DELETE", "/api/trips/1", "", nil); rec.Code != http.StatusNotFound {
		t.Errorf("delete again: %d", rec.Code)
	}
}

func TestCORS(t *testing.T) {
	h := setup(t, &fakeExtractor{})
	req := httptest.NewRequest("OPTIONS", "/api/trips", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Error("allowed origin not echoed")
	}

	req.Header.Set("Origin", "http://evil.example")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Error("unknown origin allowed")
	}
}
