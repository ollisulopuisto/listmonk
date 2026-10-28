package core

import (
	"reflect"
	"testing"
)

func TestStrSliceContains(t *testing.T) {
	tests := []struct {
		str      string
		sl       []string
		expected bool
	}{
		{"apple", []string{"apple", "banana", "cherry"}, true},
		{"grape", []string{"apple", "banana", "cherry"}, false},
		{"", []string{"apple", "banana", "cherry"}, false},
		{"apple", []string{}, false},
	}

	for _, test := range tests {
		if result := strSliceContains(test.str, test.sl); result != test.expected {
			t.Errorf("strSliceContains(%q, %v) = %v; want %v", test.str, test.sl, result, test.expected)
		}
	}
}

func TestMakeSearchQuery(t *testing.T) {
	sortFields := []string{"name", "created_at", "updated_at"}
	queryTpl := "SELECT * FROM items ORDER BY %order%"

	tests := []struct {
		searchStr      string
		orderBy        string
		order          string
		expectedSearch string
		expectedQuery  string
	}{
		{
			searchStr:      "  hello   world  ",
			orderBy:        "name",
			order:          "asc",
			expectedSearch: "hello world",
			expectedQuery:  "SELECT * FROM items ORDER BY name asc",
		},
		{
			searchStr:      "test",
			orderBy:        "name; DROP TABLE users;",
			order:          "desc",
			expectedSearch: "test",
			expectedQuery:  "SELECT * FROM items ORDER BY created_at desc",
		},
		{
			searchStr:      "test",
			orderBy:        "name",
			order:          "asc; DROP TABLE users;",
			expectedSearch: "test",
			expectedQuery:  "SELECT * FROM items ORDER BY name desc",
		},
		{
			searchStr:      "",
			orderBy:        "invalid_field",
			order:          "invalid_order",
			expectedSearch: "",
			expectedQuery:  "SELECT * FROM items ORDER BY created_at desc",
		},
	}

	for _, tc := range tests {
		gotSearch, gotQuery := makeSearchQuery(tc.searchStr, tc.orderBy, tc.order, queryTpl, sortFields)
		if gotSearch != tc.expectedSearch {
			t.Errorf("makeSearchQuery searchStr = %q; want %q", gotSearch, tc.expectedSearch)
		}
		if gotQuery != tc.expectedQuery {
			t.Errorf("makeSearchQuery query = %q; want %q", gotQuery, tc.expectedQuery)
		}
	}
}

func TestNormalizeTags(t *testing.T) {
	tests := []struct {
		tags     []string
		expected []string
	}{
		{[]string{"tag1", "tag 2", "  tag3  "}, []string{"tag1", "tag-2", "tag3"}},
		{[]string{"  ", ""}, nil},
		{[]string{"TAG1", "Tag2"}, []string{"tag1", "tag2"}}, // tags should be lower-cased
	}

	for _, test := range tests {
		result := normalizeTags(test.tags)
		if !reflect.DeepEqual(result, test.expected) {
			t.Errorf("normalizeTags(%v) = %v; want %v", test.tags, result, test.expected)
		}
	}
}

func TestStrHasLen(t *testing.T) {
	tests := []struct {
		str      string
		min, max int
		expected bool
	}{
		{"abc", 1, 5, true},
		{"abc", 3, 3, true},
		{"abc", 4, 5, false},
		{"", 0, 0, true},
	}

	for _, test := range tests {
		if result := strHasLen(test.str, test.min, test.max); result != test.expected {
			t.Errorf("strHasLen(%q, %d, %d) = %v; want %v", test.str, test.min, test.max, result, test.expected)
		}
	}
}

// TestSanitizeSQLExp ensures arbitrary SQL expressions from the frontend
// cannot inject additional statements or comments into a query.
func TestSanitizeSQLExp(t *testing.T) {
	valid := []string{
		"",
		"subscribers.name = 'foo'",
		"subscribers.id IN (SELECT id FROM lists)",
		"subscribers.status != 'deleted'",   // "deleted" is not the disallowed "delete" keyword
		"subscribers.updated_at > NOW()",    // "updated" is not the disallowed "update" keyword
		"subscribers.email = 'x@delete.io'", // "delete" inside data is fine
		"TRUE",
	}
	for _, q := range valid {
		out, err := sanitizeSQLExp(q)
		if err != nil {
			t.Errorf("sanitizeSQLExp(%q) returned error: %v", q, err)
		}
		if out != q {
			t.Errorf("sanitizeSQLExp(%q) = %q; want %q", q, out, q)
		}
	}

	invalid := []string{
		"true; DROP TABLE subscribers",
		"subscribers.id = 1; DELETE FROM subscribers",
		"true -- drop table subscribers",
		"true /* drop table */",
		"DROP TABLE subscribers",
		"DELETE FROM subscribers WHERE id = 1",
		"UPDATE subscribers SET status = 'blocklisted'",
		"1; TRUNCATE subscribers",
		"1 /* comment */",
	}
	for _, q := range invalid {
		if _, err := sanitizeSQLExp(q); err == nil {
			t.Errorf("sanitizeSQLExp(%q) should reject unsafe SQL", q)
		}
	}
}
