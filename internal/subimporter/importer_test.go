package subimporter

import (
	"testing"
)

func TestCheckInList(t *testing.T) {
	domains := []string{"example.com", "*.mail.example.org", "test.org"}
	mp, hasWildcards := makeDomainMap(domains)

	im := &Importer{}

	tests := []struct {
		domain   string
		expected bool
	}{
		{"example.com", true},
		{"sub.example.com", false},
		{"test.org", true},
		{"mail.example.org", true}, // stripped *. prefix included by makeDomainMap
		{"abc.mail.example.org", true}, // wildcard match
		{"def.mail.example.org", true}, // wildcard match
		{"unknown.org", false},
		{"org", false},
		{"", false},
	}

	for _, tt := range tests {
		got := im.checkInList(tt.domain, hasWildcards, mp)
		if got != tt.expected {
			t.Errorf("checkInList(%q) = %v; want %v", tt.domain, got, tt.expected)
		}
	}
}

func BenchmarkCheckInList_DirectMatch(b *testing.B) {
	domains := []string{"example.com", "*.mail.example.org"}
	mp, hasWildcards := makeDomainMap(domains)
	im := &Importer{}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = im.checkInList("example.com", hasWildcards, mp)
	}
}

func BenchmarkCheckInList_WildcardMatch(b *testing.B) {
	domains := []string{"example.com", "*.mail.example.org"}
	mp, hasWildcards := makeDomainMap(domains)
	im := &Importer{}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = im.checkInList("newsletter.mail.example.org", hasWildcards, mp)
	}
}

func BenchmarkCheckInList_SubdomainNoMatch(b *testing.B) {
	domains := []string{"example.com", "*.mail.example.org"}
	mp, hasWildcards := makeDomainMap(domains)
	im := &Importer{}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = im.checkInList("newsletter.other.example.org", hasWildcards, mp)
	}
}
