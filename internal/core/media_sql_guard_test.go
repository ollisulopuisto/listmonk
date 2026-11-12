package core

import (
	"os"
	"strings"
	"testing"
)

// mediaQueriesMissingPrefix returns the names of the protected queries in sql
// whose own block lacks the filename-prefix predicate.
func mediaQueriesMissingPrefix(sql string, names []string) []string {
	blocks := map[string]string{}
	cur := ""
	for _, line := range strings.Split(sql, "\n") {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(line), "-- name:"); ok {
			cur = strings.Fields(rest)[0]
			continue
		}
		blocks[cur] += line + "\n"
	}
	var missing []string
	for _, n := range names {
		if !strings.Contains(blocks[n], "filename ILIKE ANY(") {
			missing = append(missing, n)
		}
	}
	return missing
}

var protectedMediaQueries = []string{"query-media", "get-media-tags", "update-media"}

// Guard: the fork restricts media queries by permitted filename prefix.
// Upstream's versions have no such predicate, so a careless upstream sync
// would silently drop it. Each query is checked on its own.
func TestMediaQueriesKeepPrefixRestriction(t *testing.T) {
	b, err := os.ReadFile("../../queries/media.sql")
	if err != nil {
		t.Fatal(err)
	}
	if m := mediaQueriesMissingPrefix(string(b), protectedMediaQueries); len(m) > 0 {
		t.Fatalf("queries/media.sql lacks the filename prefix predicate in: %v", m)
	}
}

// The guard must flag a query that loses its predicate even when the other
// queries carry more than one.
func TestMediaGuardDetectsSingleMissingPredicate(t *testing.T) {
	sql := "-- name: query-media\nfilename ILIKE ANY($1) OR filename ILIKE ANY($2)\n" +
		"-- name: get-media-tags\nfilename ILIKE ANY($1) OR filename ILIKE ANY($2)\n" +
		"-- name: update-media\nSELECT 1\n"
	m := mediaQueriesMissingPrefix(sql, protectedMediaQueries)
	if len(m) != 1 || m[0] != "update-media" {
		t.Fatalf("expected only update-media flagged, got %v", m)
	}
}
