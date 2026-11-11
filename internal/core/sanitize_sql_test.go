package core

import "testing"

// TestSanitizeSQLExpRejectsInjection covers the subscriber filter expression
// sanitizer. These expressions are interpolated into raw SQL, so anything that
// could break out of the WHERE clause must be rejected.
func TestSanitizeSQLExpRejectsInjection(t *testing.T) {
	reject := []string{
		"; DROP TABLE subscribers; --",
		"-- comment",
		"/* comment */",
		"DROP TABLE subscribers",
		"TRUNCATE subscribers",
		"CREATE TABLE x",
		"ALTER TABLE subscribers",
		"INSERT INTO subscribers",
		"UPDATE subscribers SET x=1",
		"DELETE FROM subscribers",
		"COPY subscribers TO '/tmp/x'",
		"VACUUM",
		"EXEC pg_sleep(5)",
		"EXECUTE pg_sleep(5)",
		"1=1; SELECT pg_sleep(5)",
		"pg_sleep(5)",
		"pg_read_file('/etc/passwd')",
		"set_config('x','y')",
		"dblink('x','y')",
		"nextval('x')",
		"1 AND pg_sleep(5)",
		"name = 'x'; DROP TABLE subscribers",
		// Parenthesis breakouts: a `)` at depth zero closes the surrounding
		// AND group and turns permitted-list scoping into a no-op.
		"FALSE) OR (TRUE",
		"TRUE)) IS TRUE OR ((TRUE",
		"(TRUE",
		"TRUE(",
		"name = 'a') OR ('1'='1",
		// Escape string literals (E'...') process backslash escapes, so a
		// plain-quote scan misreads their end and hides the depth-zero close
		// (and any non-allowlisted function call) after it. Refused outright.
		`name = E'\'' ) OR (TRUE`,
		`name = e'\'') OR (TRUE`,
		`TRUE AND E'\'' IS NULL) OR (TRUE`,
		`E'\'' IS NULL) OR (pg_sleep(2) IS NULL OR name IS NOT NULL`,
		`name = E'x'`,
		`name = e'media'`,
		`E'' = ''`,
		// Unicode escape literals process backslash/UESCAPE escapes; refused.
		`name = U&'d\0061t'`,
		`name = u&'x'`,
		`U&"x" = 'y'`,
		`name = U&'a' UESCAPE '!'`,
		// Bit strings: refused with the other prefixed literals.
		"flags = b'1010'",
		"flags = X'1A'",
		// Unterminated literals fail closed (they are never valid SQL).
		"name = 'abc",
		"name = \"abc",
		"name = $$abc",
		"name = $tag$abc ) OR ( TRUE",
		// A '' pair inside a literal does not rebalance a later breakout.
		"name = 'it''s' ) OR (TRUE",
	}
	for _, q := range reject {
		if _, err := sanitizeSQLExp(q); err == nil {
			t.Errorf("sanitizeSQLExp(%q) should have been rejected, got nil error", q)
		}
	}

	accept := []string{
		"",
		"name = 'foo'",
		"email LIKE '%example.com'",
		"status = 1 AND (list_id = 2 OR list_id = 3)",
		"lower(email) = lower('FOO@Example.COM')",
		"length(name) > 3",
		"created_at > now() - interval '7 days'",
		"coalesce(name, '') <> ''",
		"name ILIKE '%foo%'",
		// Balanced nesting and parens inside string literals are fine.
		"(name = 'a' OR name = 'b') AND email LIKE '%(x)%'",
		"lower(email) IN (SELECT lower('a@example.com'))",
		"email LIKE '%''quoted''%'",
		"name = 'it''s'",
		// Dollar-quoted strings, including quotes, backslashes and parens
		// inside them.
		"name = $$it's 'quoted'$$",
		"name = $tag$a ) OR ( b$tag$",
		"name = $q$back\\slash$q$",
		// Backslashes in plain literals are inert under the pinned
		// standard_conforming_strings=on and stay usable for regex filters.
		`email ~* '@(a|b)\.com$'`,
		`name = 'a\b'`,
		`email LIKE '%\_%' ESCAPE '!'`,
	}
	for _, q := range accept {
		if _, err := sanitizeSQLExp(q); err != nil {
			t.Errorf("sanitizeSQLExp(%q) should have been accepted, got %v", q, err)
		}
	}
}
