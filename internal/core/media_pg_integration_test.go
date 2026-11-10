package core

// Live-PostgreSQL regression test for the media tag update authorization
// fix (PR #46 review): PUT /api/media/:id must apply the same active-provider
// and permitted filename-prefix predicate as the media gallery, so a
// list-restricted user cannot modify another list's media by ID. Skipped
// unless LISTMONK_TEST_PG_URI points at a throwaway database, e.g.:
//
//	LISTMONK_TEST_PG_URI="postgres://postgres@localhost:5432/secverify?sslmode=disable" go test ./internal/core/ -run PG -v
//
// The test only needs an empty database; it creates and drops its own table.

import (
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/jmoiron/sqlx"
	"github.com/knadh/goyesql/v2"
	"github.com/knadh/listmonk/models"
	"github.com/lib/pq"
)

// fakeMediaStore satisfies media.Store for URL decoration; no storage is
// touched by UpdateMedia.
type fakeMediaStore struct{}

func (fakeMediaStore) Put(string, string, io.ReadSeeker) (string, error) { return "", nil }
func (fakeMediaStore) Delete(string) error                               { return nil }
func (fakeMediaStore) GetURL(name string) string                         { return "https://media.test/" + name }
func (fakeMediaStore) GetBlob(string) ([]byte, error)                    { return nil, nil }

// prepareMediaQueries parses the real queries/media.sql (the same file the
// app prepares statements from) and prepares update-media and get-media
// against the test database, so the regression exercises the shipped SQL
// rather than a copy.
func prepareMediaQueries(t *testing.T, db *sqlx.DB) *models.Queries {
	t.Helper()

	b, err := os.ReadFile(filepath.Join("..", "..", "queries", "media.sql"))
	if err != nil {
		t.Fatalf("reading queries/media.sql: %v", err)
	}
	qMap, err := goyesql.ParseBytes(b)
	if err != nil {
		t.Fatalf("parsing queries/media.sql: %v", err)
	}

	q := &models.Queries{}
	if q.UpdateMedia, err = db.Preparex(qMap["update-media"].Query); err != nil {
		t.Fatalf("preparing update-media: %v", err)
	}
	if q.GetMedia, err = db.Preparex(qMap["get-media"].Query); err != nil {
		t.Fatalf("preparing get-media: %v", err)
	}
	return q
}

func seedMedia(t *testing.T, c *Core) (ownID, otherID, publicID int) {
	t.Helper()

	if _, err := c.db.Exec(`DROP TABLE IF EXISTS media`); err != nil {
		t.Fatalf("dropping media table: %v", err)
	}
	if _, err := c.db.Exec(`CREATE TABLE media (
		id           SERIAL PRIMARY KEY,
		uuid         uuid NOT NULL UNIQUE,
		provider     TEXT NOT NULL DEFAULT '',
		filename     TEXT NOT NULL,
		content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
		thumb        TEXT NOT NULL,
		tags         TEXT[] NOT NULL DEFAULT '{}',
		meta         JSONB NOT NULL DEFAULT '{}',
		created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW())`); err != nil {
		t.Fatalf("creating media table: %v", err)
	}
	t.Cleanup(func() {
		if _, err := c.db.Exec(`DROP TABLE IF EXISTS media`); err != nil {
			t.Logf("dropping media table: %v", err)
		}
	})

	rows := []struct {
		uuid     string
		filename string
		provider string
	}{
		{"00000000-0000-0000-0000-0000000000a1", "list-1/pic.png", "filesystem"},    // permitted for a list-1 user
		{"00000000-0000-0000-0000-0000000000a2", "list-2/secret.png", "filesystem"}, // another list's item, hidden from a list-1 user
		{"00000000-0000-0000-0000-0000000000a3", "public/logo.png", "filesystem"},   // public namespace, visible to everyone
	}
	ids := make([]int, 0, len(rows))
	for _, r := range rows {
		var id int
		if err := c.db.QueryRow(`INSERT INTO media (uuid, provider, filename, thumb, tags)
			VALUES ($1::uuid, $2, $3, '', '{old}') RETURNING id`, r.uuid, r.provider, r.filename).Scan(&id); err != nil {
			t.Fatalf("seeding %s: %v", r.filename, err)
		}
		ids = append(ids, id)
	}
	return ids[0], ids[1], ids[2]
}

// list1Prefixes mirrors getMediaPrefixes() in cmd/media.go for a user
// permitted to manage list 1 only.
var list1Prefixes = []string{"list-1/%", "list-1-%", "public/%", "public-%"}

func mediaTags(t *testing.T, c *Core, id int) []string {
	t.Helper()
	var tags []string
	if err := c.db.QueryRow(`SELECT tags FROM media WHERE id=$1`, id).Scan(pq.Array(&tags)); err != nil {
		t.Fatalf("reading tags for %d: %v", id, err)
	}
	return tags
}

// TestUpdateMediaListScopePG proves against a live PostgreSQL that
// Core.UpdateMedia applies the permitted-prefix and active-provider
// predicate to the update itself: a list-1-restricted caller updates its own
// and public items, but targeting another list's item or a foreign
// provider's item yields ErrNotFound and leaves it untouched, while an
// unrestricted (all lists) caller is not limited.
func TestUpdateMediaListScopePG(t *testing.T) {
	c := &Core{db: pgTestDB(t).Unsafe()}
	c.q = prepareMediaQueries(t, c.db)
	ownID, otherID, publicID := seedMedia(t, c)
	store := fakeMediaStore{}

	// Allowed: own list's item updates and returns the new tags.
	m, err := c.UpdateMedia(ownID, "filesystem", list1Prefixes, []string{"changed"}, store)
	if err != nil {
		t.Fatalf("update own item: %v", err)
	}
	if len(m.Tags) != 1 || m.Tags[0] != "changed" {
		t.Fatalf("own item tags = %v, want [changed]", m.Tags)
	}

	// Allowed: public namespace stays reachable, consistent with the gallery.
	if _, err := c.UpdateMedia(publicID, "filesystem", list1Prefixes, []string{"changed"}, store); err != nil {
		t.Fatalf("update public item: %v", err)
	}

	// Rejected: another list's item returns ErrNotFound and is untouched.
	if _, err := c.UpdateMedia(otherID, "filesystem", list1Prefixes, []string{"changed"}, store); err != ErrNotFound {
		t.Fatalf("update other list's item: err = %v, want ErrNotFound", err)
	}
	if tags := mediaTags(t, c, otherID); len(tags) != 1 || tags[0] != "old" {
		t.Fatalf("other list's item tags = %v, want unchanged [old]", tags)
	}

	// Rejected: active-provider mismatch, even for an otherwise permitted name.
	if _, err := c.UpdateMedia(ownID, "s3", list1Prefixes, []string{"changed"}, store); err != ErrNotFound {
		t.Fatalf("update with wrong provider: err = %v, want ErrNotFound", err)
	}

	// Unrestricted caller (all lists, empty prefixes) can update any item.
	if _, err := c.UpdateMedia(otherID, "filesystem", nil, []string{"admin"}, store); err != nil {
		t.Fatalf("update as all-lists user: %v", err)
	}
	if tags := mediaTags(t, c, otherID); len(tags) != 1 || tags[0] != "admin" {
		t.Fatalf("other list's item tags = %v, want [admin]", tags)
	}
}
