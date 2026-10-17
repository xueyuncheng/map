package extract

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"

	"travelmap/internal/trip"
)

// fakeAPI serves a canned Messages API response whose save_trips tool call
// carries input, and records the request body.
func fakeAPI(t *testing.T, stopReason, input string) (*Claude, *map[string]any) {
	t.Helper()
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &got); err != nil {
			t.Errorf("request body is not JSON: %v", err)
		}
		if beta := r.Header.Get("anthropic-beta"); !strings.Contains(beta, "server-side-fallback-2026-06-01") {
			t.Errorf("anthropic-beta header = %q", beta)
		}
		content := `{"type":"tool_use","id":"toolu_1","name":"save_trips","input":` + input + `}`
		if !json.Valid([]byte(input)) {
			// Simulate a truncated/refused response with no usable tool call.
			content = `{"type":"text","text":"..."}`
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5",
			"stop_reason":"`+stopReason+`","usage":{"input_tokens":1,"output_tokens":1},
			"content":[`+content+`]}`)
	}))
	t.Cleanup(srv.Close)
	c := &Claude{
		client: anthropic.NewClient(option.WithAPIKey("test"), option.WithBaseURL(srv.URL), option.WithMaxRetries(0)),
		model:  "claude-opus-5",
	}
	return c, &got
}

const sample = `{"trips":[
	{"type":"flight","origin":{"name":"上海","country":"CN","lat":31.23,"lng":121.47},
	 "destination":{"name":"东京","country":"JP","lat":35.68,"lng":139.69},
	 "start_date":"2026-05-01","end_date":"2026-05-01","provider":"中国东方航空",
	 "order_number":"E123","notes":"MU523 PVG→NRT"},
	{"type":"hotel","origin":null,
	 "destination":{"name":"东京","country":"JP","lat":35.68,"lng":139.69},
	 "start_date":"2026-05-01","end_date":"2026-05-04","provider":"Hotel","order_number":"","notes":""}
]}`

func TestExtractSendsImageAndSchema(t *testing.T) {
	c, req := fakeAPI(t, "tool_use", sample)
	png := []byte("\x89PNG\r\n\x1a\nfake")
	trips, err := c.Extract(context.Background(), png, "image/png")
	if err != nil {
		t.Fatal(err)
	}

	if len(trips) != 2 {
		t.Fatalf("got %d trips, want 2", len(trips))
	}
	if trips[0].Origin == nil || trips[0].Origin.Name != "上海" || trips[0].Destination.Country != "JP" {
		t.Errorf("flight parsed wrong: %+v", trips[0])
	}
	if trips[1].Type != trip.Hotel || trips[1].Origin != nil {
		t.Errorf("hotel parsed wrong: %+v", trips[1])
	}
	for _, tr := range trips {
		if err := tr.Validate(); err != nil {
			t.Errorf("sample trip invalid: %v", err)
		}
	}

	r := *req
	if r["model"] != "claude-opus-5" {
		t.Errorf("model = %v", r["model"])
	}
	fallbacks, _ := r["fallbacks"].([]any)
	if len(fallbacks) != 1 || fallbacks[0].(map[string]any)["model"] != "claude-opus-4-8" {
		t.Errorf("fallbacks = %v", r["fallbacks"])
	}
	tools, _ := r["tools"].([]any)
	tool, _ := tools[0].(map[string]any)
	schema, _ := tool["input_schema"].(map[string]any)
	if tool["name"] != toolName || tool["strict"] != true || schema["additionalProperties"] != false || schema["properties"] == nil {
		t.Errorf("tool = %v", tool)
	}
	if choice, _ := r["tool_choice"].(map[string]any); choice["type"] != "tool" || choice["name"] != toolName {
		t.Errorf("tool_choice = %v", r["tool_choice"])
	}
	msgs, _ := r["messages"].([]any)
	content := msgs[0].(map[string]any)["content"].([]any)
	img := content[0].(map[string]any)
	src := img["source"].(map[string]any)
	if img["type"] != "image" || src["type"] != "base64" || src["media_type"] != "image/png" || src["data"] == "" {
		t.Errorf("image block = %v", img)
	}
}

func TestExtractStopReasons(t *testing.T) {
	for reason, want := range map[string]error{"refusal": ErrRefused, "max_tokens": ErrTruncated} {
		c, _ := fakeAPI(t, reason, `{"trips":[`)
		if _, err := c.Extract(context.Background(), []byte("x"), "image/png"); !errors.Is(err, want) {
			t.Errorf("%s: err = %v, want %v", reason, err, want)
		}
	}
}

func TestParseOutputRejectsGarbage(t *testing.T) {
	if _, err := parseOutput("not json"); err == nil {
		t.Fatal("expected error")
	}
}
