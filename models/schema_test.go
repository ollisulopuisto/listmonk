package models

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// reContentTypeEnum captures the values of the `content_type` enum in schema.sql.
var reContentTypeEnum = regexp.MustCompile(`(?is)CREATE\s+TYPE\s+content_type\s+AS\s+ENUM\s*\(([^)]*)\)`)

// TestSchemaContentTypeEnumCoversAllConstants guards a fresh-install hazard.
//
// `--install` applies schema.sql and then records the latest migration version
// *without* running migrations, so any content type introduced by a migration
// must also exist in schema.sql. Otherwise a fresh install ends up with an
// enum that a migrated database has, and inserting a campaign of that type
// fails at runtime with an invalid enum value.
func TestSchemaContentTypeEnumCoversAllConstants(t *testing.T) {
	b, err := os.ReadFile("../schema.sql")
	if err != nil {
		t.Fatalf("reading schema.sql: %v", err)
	}

	m := reContentTypeEnum.FindSubmatch(b)
	if len(m) != 2 {
		t.Fatal("could not locate the content_type enum in schema.sql")
	}

	got := map[string]bool{}
	for _, v := range strings.Split(string(m[1]), ",") {
		if v = strings.Trim(strings.TrimSpace(v), "'"); v != "" {
			got[v] = true
		}
	}

	// Every content type the application can persist must be in the enum.
	want := []string{
		CampaignContentTypeRichtext,
		CampaignContentTypeHTML,
		CampaignContentTypeMarkdown,
		CampaignContentTypeEmailMarkdown,
		CampaignContentTypePlain,
		CampaignContentTypeVisual,
	}

	for _, w := range want {
		if !got[w] {
			t.Errorf("content_type enum in schema.sql is missing %q; fresh installs will reject campaigns of this type", w)
		}
	}
}
