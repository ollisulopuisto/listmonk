package core

import (
	"os"
	"strings"
	"testing"
)

// Guard: the fork restricts media queries by permitted filename prefix
// (query-media, get-media-tags, update-media). Upstream's versions have no
// such predicate, so a careless upstream sync would silently drop it.
func TestMediaQueriesKeepPrefixRestriction(t *testing.T) {
	b, err := os.ReadFile("../../queries/media.sql")
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(string(b), "filename ILIKE ANY("); n < 3 {
		t.Fatalf("queries/media.sql must restrict query-media, get-media-tags and update-media by filename prefix; found %d predicates", n)
	}
}
