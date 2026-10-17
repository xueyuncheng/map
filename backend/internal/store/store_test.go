package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"travelmap/internal/trip"
)

func TestCRUD(t *testing.T) {
	ctx := context.Background()
	st, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	flight, err := st.Create(ctx, trip.Trip{
		Type:        trip.Flight,
		Origin:      &trip.Place{Name: "Beijing", Country: "CN", Lat: 39.9, Lng: 116.4},
		Destination: trip.Place{Name: "Paris", Country: "FR", Lat: 48.86, Lng: 2.35},
		StartDate:   "2026-03-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	hotel, err := st.Create(ctx, trip.Trip{
		Type:        trip.Hotel,
		Destination: trip.Place{Name: "Paris", Country: "FR", Lat: 48.86, Lng: 2.35},
		StartDate:   "2026-03-02",
	})
	if err != nil {
		t.Fatal(err)
	}

	list, err := st.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != hotel.ID {
		t.Fatalf("list not ordered by start_date desc: %+v", list)
	}
	if list[0].Origin != nil {
		t.Error("hotel origin should be nil")
	}
	if list[1].Origin == nil || list[1].Origin.Name != "Beijing" {
		t.Errorf("flight origin lost: %+v", list[1].Origin)
	}

	flight.Notes = "CA933"
	flight.Origin = nil
	updated, err := st.Update(ctx, flight)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Notes != "CA933" || updated.Origin != nil || updated.CreatedAt.IsZero() {
		t.Errorf("update wrong: %+v", updated)
	}

	if err := st.Delete(ctx, flight.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.Delete(ctx, flight.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete: %v", err)
	}
	if _, err := st.Update(ctx, flight); !errors.Is(err, ErrNotFound) {
		t.Errorf("update missing: %v", err)
	}
}

func TestOpenNormalizesCountries(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "test.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	// Bypass validation to simulate rows written by an older version.
	if _, err := st.db.Exec(`INSERT INTO trips (type, origin_name, origin_country, origin_lat, origin_lng,
		dest_name, dest_country, dest_lat, dest_lng, created_at)
		VALUES ('flight', '北京', '中国', 39.9, 116.4, '澳门', '中国澳门', 22.2, 113.5, '2026-01-01T00:00:00Z'),
		       ('hotel', NULL, NULL, NULL, NULL, '曼谷', '泰国', 13.75, 100.5, '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	st.Close()

	st, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	list, err := st.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, tr := range list {
		if tr.Origin != nil {
			got[tr.Origin.Name] = tr.Origin.Country
		} else if tr.Type == trip.Hotel {
			got["hotel origin"] = "nil"
		}
		got[tr.Destination.Name] = tr.Destination.Country
	}
	want := map[string]string{"北京": "CN", "澳门": "MO", "曼谷": "TH", "hotel origin": "nil"}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s: got %q, want %q", k, got[k], v)
		}
	}
}
