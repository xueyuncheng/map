// Package store persists trips in SQLite.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"

	"travelmap/internal/trip"
)

var ErrNotFound = errors.New("trip not found")

const schema = `
CREATE TABLE IF NOT EXISTS trips (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	type          TEXT    NOT NULL,
	origin_name   TEXT,
	origin_country TEXT,
	origin_lat    REAL,
	origin_lng    REAL,
	dest_name     TEXT    NOT NULL,
	dest_country  TEXT    NOT NULL DEFAULT '',
	dest_lat      REAL    NOT NULL,
	dest_lng      REAL    NOT NULL,
	start_date    TEXT    NOT NULL DEFAULT '',
	end_date      TEXT    NOT NULL DEFAULT '',
	provider      TEXT    NOT NULL DEFAULT '',
	order_number  TEXT    NOT NULL DEFAULT '',
	notes         TEXT    NOT NULL DEFAULT '',
	created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS trips_start_date ON trips(start_date);
`

const columns = `id, type, origin_name, origin_country, origin_lat, origin_lng,
	dest_name, dest_country, dest_lat, dest_lng,
	start_date, end_date, provider, order_number, notes, created_at`

type Store struct {
	db *sql.DB
}

// Open opens (creating if needed) the SQLite database at path.
func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite allows a single writer; one connection avoids SQLITE_BUSY on writes.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if err := normalizeCountries(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("normalize countries: %w", err)
	}
	return &Store{db: db}, nil
}

// normalizeCountries rewrites country names left by older versions or direct
// imports (for example "中国澳门") as ISO codes, so stats count each country once.
func normalizeCountries(db *sql.DB) error {
	rows, err := db.Query(`SELECT id, COALESCE(origin_country, ''), dest_country FROM trips`)
	if err != nil {
		return err
	}
	type fix struct {
		id           int64
		origin, dest string
	}
	var fixes []fix
	for rows.Next() {
		var f fix
		if err := rows.Scan(&f.id, &f.origin, &f.dest); err != nil {
			rows.Close()
			return err
		}
		o, d := trip.NormalizeCountry(f.origin), trip.NormalizeCountry(f.dest)
		if o != f.origin || d != f.dest {
			fixes = append(fixes, fix{f.id, o, d})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, f := range fixes {
		// NULLIF keeps origin_country NULL for trips without an origin.
		if _, err := db.Exec(`UPDATE trips SET origin_country = NULLIF(?, ''), dest_country = ? WHERE id = ?`,
			f.origin, f.dest, f.id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) List(ctx context.Context) ([]trip.Trip, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+columns+` FROM trips ORDER BY start_date DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	trips := []trip.Trip{}
	for rows.Next() {
		t, err := scan(rows)
		if err != nil {
			return nil, err
		}
		trips = append(trips, t)
	}
	return trips, rows.Err()
}

func (s *Store) Get(ctx context.Context, id int64) (trip.Trip, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM trips WHERE id = ?`, id)
	t, err := scan(row)
	if errors.Is(err, sql.ErrNoRows) {
		return trip.Trip{}, ErrNotFound
	}
	return t, err
}

// Create inserts t and returns it with ID and CreatedAt populated.
func (s *Store) Create(ctx context.Context, t trip.Trip) (trip.Trip, error) {
	t.CreatedAt = time.Now().UTC().Truncate(time.Second)
	o := originArgs(t.Origin)
	res, err := s.db.ExecContext(ctx, `INSERT INTO trips (
		type, origin_name, origin_country, origin_lat, origin_lng,
		dest_name, dest_country, dest_lat, dest_lng,
		start_date, end_date, provider, order_number, notes, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.Type, o[0], o[1], o[2], o[3],
		t.Destination.Name, t.Destination.Country, t.Destination.Lat, t.Destination.Lng,
		t.StartDate, t.EndDate, t.Provider, t.OrderNumber, t.Notes,
		t.CreatedAt.Format(time.RFC3339))
	if err != nil {
		return trip.Trip{}, err
	}
	t.ID, err = res.LastInsertId()
	return t, err
}

// Update replaces every user-editable field of the trip with the given ID.
func (s *Store) Update(ctx context.Context, t trip.Trip) (trip.Trip, error) {
	o := originArgs(t.Origin)
	res, err := s.db.ExecContext(ctx, `UPDATE trips SET
		type = ?, origin_name = ?, origin_country = ?, origin_lat = ?, origin_lng = ?,
		dest_name = ?, dest_country = ?, dest_lat = ?, dest_lng = ?,
		start_date = ?, end_date = ?, provider = ?, order_number = ?, notes = ?
		WHERE id = ?`,
		t.Type, o[0], o[1], o[2], o[3],
		t.Destination.Name, t.Destination.Country, t.Destination.Lat, t.Destination.Lng,
		t.StartDate, t.EndDate, t.Provider, t.OrderNumber, t.Notes, t.ID)
	if err != nil {
		return trip.Trip{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return trip.Trip{}, ErrNotFound
	}
	return s.Get(ctx, t.ID)
}

func (s *Store) Delete(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM trips WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func originArgs(p *trip.Place) [4]any {
	if p == nil {
		return [4]any{nil, nil, nil, nil}
	}
	return [4]any{p.Name, p.Country, p.Lat, p.Lng}
}

type scanner interface{ Scan(dest ...any) error }

func scan(r scanner) (trip.Trip, error) {
	var (
		t         trip.Trip
		oName     sql.NullString
		oCountry  sql.NullString
		oLat      sql.NullFloat64
		oLng      sql.NullFloat64
		createdAt string
	)
	err := r.Scan(&t.ID, &t.Type, &oName, &oCountry, &oLat, &oLng,
		&t.Destination.Name, &t.Destination.Country, &t.Destination.Lat, &t.Destination.Lng,
		&t.StartDate, &t.EndDate, &t.Provider, &t.OrderNumber, &t.Notes, &createdAt)
	if err != nil {
		return trip.Trip{}, err
	}
	if oName.Valid {
		t.Origin = &trip.Place{Name: oName.String, Country: oCountry.String, Lat: oLat.Float64, Lng: oLng.Float64}
	}
	t.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	return t, nil
}
