// Package extract turns a travel order screenshot into trip records using
// Claude's vision and structured outputs.
package extract

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"

	"travelmap/internal/trip"
)

// ErrRefused is returned when the model declines to process the image.
var ErrRefused = errors.New("model refused to process the image")

// ErrTruncated is returned when the response hit max_tokens before the JSON
// was complete.
var ErrTruncated = errors.New("model response was truncated")

type Extractor interface {
	// Extract returns the trips found in the image. The trips are not
	// validated or persisted; callers decide what to keep.
	Extract(ctx context.Context, image []byte, mediaType string) ([]trip.Trip, error)
}

type Claude struct {
	client anthropic.Client
	model  string
}

// NewClaude creates an extractor. The API key is read from ANTHROPIC_API_KEY
// when apiKey is empty.
func NewClaude(apiKey, model string) *Claude {
	opts := []option.RequestOption{option.WithRequestTimeout(2 * time.Minute)}
	if apiKey != "" {
		opts = append(opts, option.WithAPIKey(apiKey))
	}
	return &Claude{client: anthropic.NewClient(opts...), model: model}
}

const systemPrompt = `You extract travel records from screenshots of booking or order pages
(airline, railway such as 12306, Ctrip/Trip.com, Fliggy, Qunar, Booking.com, Airbnb, bus and
ferry operators, e-tickets, boarding passes, hotel confirmations). The screenshot may be in any
language, most often Chinese or English.

Return one entry per leg or stay:
- A round trip or a connecting itinerary is several entries, one per segment.
- A hotel or other accommodation is one "hotel" entry with origin null, destination = the
  hotel's city, start_date = check-in, end_date = check-out.
- For transport, start_date is the departure date and end_date the arrival date (same day if
  not shown).

Places:
- Use the city name for "name" (for example "Shanghai", not "Pudong International Airport"),
  written in the language shown in the screenshot. Mention the station or airport in notes.
- "country" is the ISO 3166-1 alpha-2 code, uppercase (for example "CN", "JP").
- lat/lng are the city centre's coordinates in decimal degrees. Give your best estimate.

Dates are YYYY-MM-DD. If the year is not visible, infer the most plausible year given that
today is %s; use "" only when the date is not shown at all.

provider is the airline, railway, hotel or platform name; order_number is the booking,
ticket or confirmation number exactly as shown. Use "" for anything not visible.
notes is a short summary such as the flight or train number, seat class and stations.

Do not invent trips. If the image is not a travel order, return an empty trips list.`

type placeOut struct {
	Name    string  `json:"name"`
	Country string  `json:"country"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
}

type tripOut struct {
	Type        trip.Type `json:"type"`
	Origin      *placeOut `json:"origin"`
	Destination placeOut  `json:"destination"`
	StartDate   string    `json:"start_date"`
	EndDate     string    `json:"end_date"`
	Provider    string    `json:"provider"`
	OrderNumber string    `json:"order_number"`
	Notes       string    `json:"notes"`
}

type output struct {
	Trips []tripOut `json:"trips"`
}

func placeSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name":    map[string]any{"type": "string"},
			"country": map[string]any{"type": "string"},
			"lat":     map[string]any{"type": "number"},
			"lng":     map[string]any{"type": "number"},
		},
		"required":             []string{"name", "country", "lat", "lng"},
		"additionalProperties": false,
	}
}

func outputSchema() map[string]any {
	types := make([]string, len(trip.Types))
	for i, t := range trip.Types {
		types[i] = string(t)
	}
	str := map[string]any{"type": "string"}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"trips": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"type":         map[string]any{"type": "string", "enum": types},
						"origin":       map[string]any{"anyOf": []any{placeSchema(), map[string]any{"type": "null"}}},
						"destination":  placeSchema(),
						"start_date":   str,
						"end_date":     str,
						"provider":     str,
						"order_number": str,
						"notes":        str,
					},
					"required": []string{"type", "origin", "destination", "start_date",
						"end_date", "provider", "order_number", "notes"},
					"additionalProperties": false,
				},
			},
		},
		"required":             []string{"trips"},
		"additionalProperties": false,
	}
}

const toolName = "save_trips"

// saveTripsTool returns the result schema as a strict tool. A forced strict
// tool call is used instead of output_config.format because some API
// gateways drop output_config and let the model answer in free text.
func saveTripsTool() anthropic.BetaToolUnionParam {
	schema := outputSchema()
	return anthropic.BetaToolUnionParam{OfTool: &anthropic.BetaToolParam{
		Name:        toolName,
		Description: anthropic.String("Save the travel records extracted from the screenshot."),
		Strict:      anthropic.Bool(true),
		InputSchema: anthropic.BetaToolInputSchemaParam{
			Properties:  schema["properties"],
			Required:    schema["required"].([]string),
			ExtraFields: map[string]any{"additionalProperties": false},
		},
	}}
}

func (c *Claude) Extract(ctx context.Context, image []byte, mediaType string) ([]trip.Trip, error) {
	today := time.Now().Format(trip.DateLayout)
	// The beta endpoint is used only for server-side refusal fallbacks: if the
	// primary model declines, the API re-serves the request on the fallback
	// model within the same call. Opus 4.8 is pinned (rather than "default"
	// routing) because it supports the forced tool_choice used here.
	resp, err := c.client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
		Model:     anthropic.Model(c.model),
		MaxTokens: 16000,
		Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_06_01},
		Fallbacks: anthropic.BetaFallbacksParamUnion{
			OfBetaFallbackArray: []anthropic.BetaFallbackParam{{Model: "claude-opus-4-8"}},
		},
		System: []anthropic.BetaTextBlockParam{{Text: fmt.Sprintf(systemPrompt, today)}},
		OutputConfig: anthropic.BetaOutputConfigParam{
			Effort: anthropic.BetaOutputConfigEffortMedium,
		},
		Tools: []anthropic.BetaToolUnionParam{saveTripsTool()},
		ToolChoice: anthropic.BetaToolChoiceUnionParam{
			OfTool: &anthropic.BetaToolChoiceToolParam{Name: toolName},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(
				anthropic.NewBetaImageBlock(anthropic.BetaBase64ImageSourceParam{
					Data:      base64.StdEncoding.EncodeToString(image),
					MediaType: anthropic.BetaBase64ImageSourceMediaType(mediaType),
				}),
				anthropic.NewBetaTextBlock("Extract the travel records from this order screenshot."),
			),
		},
	})
	if err != nil {
		return nil, err
	}

	switch resp.StopReason {
	case anthropic.BetaStopReasonRefusal:
		return nil, ErrRefused
	case anthropic.BetaStopReasonMaxTokens:
		return nil, ErrTruncated
	}

	for _, block := range resp.Content {
		if b, ok := block.AsAny().(anthropic.BetaToolUseBlock); ok && b.Name == toolName {
			return parseOutput(b.JSON.Input.Raw())
		}
	}
	return nil, errors.New("model did not call " + toolName)
}

func parseOutput(raw string) ([]trip.Trip, error) {
	var out output
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, fmt.Errorf("decode model output: %w", err)
	}
	trips := make([]trip.Trip, 0, len(out.Trips))
	for _, o := range out.Trips {
		t := trip.Trip{
			Type:        o.Type,
			Destination: trip.Place(o.Destination),
			StartDate:   o.StartDate,
			EndDate:     o.EndDate,
			Provider:    o.Provider,
			OrderNumber: o.OrderNumber,
			Notes:       o.Notes,
		}
		if o.Origin != nil {
			p := trip.Place(*o.Origin)
			t.Origin = &p
		}
		trips = append(trips, t)
	}
	return trips, nil
}
