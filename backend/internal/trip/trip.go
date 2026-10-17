// Package trip defines the travel record model shared by the store, the
// screenshot extractor and the HTTP API.
package trip

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type Type string

const (
	Flight Type = "flight"
	Train  Type = "train"
	Bus    Type = "bus"
	Car    Type = "car"
	Ship   Type = "ship"
	Hotel  Type = "hotel"
	Other  Type = "other"
)

// Types lists every valid trip type, in display order.
var Types = []Type{Flight, Train, Bus, Car, Ship, Hotel, Other}

func (t Type) Valid() bool {
	for _, v := range Types {
		if t == v {
			return true
		}
	}
	return false
}

// DateLayout is the only date format accepted for StartDate / EndDate.
const DateLayout = "2006-01-02"

type Place struct {
	Name    string  `json:"name"`
	Country string  `json:"country"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
}

// validate checks p and normalises its Country to an ISO 3166-1 alpha-2 code.
func (p *Place) validate(field string) error {
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("%s.name is required", field)
	}
	p.Country = NormalizeCountry(p.Country)
	if p.Country != "" && !isCountryCode(p.Country) {
		return fmt.Errorf("%s.country %q is not an ISO 3166-1 alpha-2 code", field, p.Country)
	}
	if p.Lat < -90 || p.Lat > 90 {
		return fmt.Errorf("%s.lat must be between -90 and 90", field)
	}
	if p.Lng < -180 || p.Lng > 180 {
		return fmt.Errorf("%s.lng must be between -180 and 180", field)
	}
	return nil
}

// Trip is one leg of travel (a flight, a train ride...) or a stay (hotel).
// Origin is nil for stays and for records where only the destination is known.
type Trip struct {
	ID          int64     `json:"id"`
	Type        Type      `json:"type"`
	Origin      *Place    `json:"origin"`
	Destination Place     `json:"destination"`
	StartDate   string    `json:"start_date"`
	EndDate     string    `json:"end_date"`
	Provider    string    `json:"provider"`
	OrderNumber string    `json:"order_number"`
	Notes       string    `json:"notes"`
	CreatedAt   time.Time `json:"created_at"`
}

// Validate checks user- or model-supplied fields and normalises country
// codes in place. ID and CreatedAt are server-assigned and not checked.
func (t *Trip) Validate() error {
	if !t.Type.Valid() {
		return fmt.Errorf("type %q is not one of %v", t.Type, Types)
	}
	if t.Origin != nil {
		if err := t.Origin.validate("origin"); err != nil {
			return err
		}
	}
	if err := t.Destination.validate("destination"); err != nil {
		return err
	}
	var start, end time.Time
	var err error
	if t.StartDate != "" {
		if start, err = time.Parse(DateLayout, t.StartDate); err != nil {
			return errors.New("start_date must be YYYY-MM-DD")
		}
	}
	if t.EndDate != "" {
		if end, err = time.Parse(DateLayout, t.EndDate); err != nil {
			return errors.New("end_date must be YYYY-MM-DD")
		}
	}
	if !start.IsZero() && !end.IsZero() && end.Before(start) {
		return errors.New("end_date is before start_date")
	}
	return nil
}
