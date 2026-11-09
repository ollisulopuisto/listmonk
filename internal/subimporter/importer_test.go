package subimporter

import (
	"testing"

	"github.com/knadh/listmonk/internal/i18n"
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

func TestSanitizeEmailAllowlistBlocklist(t *testing.T) {
	i18nInst, err := i18n.New([]byte(`{"_.code": "en", "_.name": "English", "subscribers.domainBlocklisted": "The e-mail domain is blocklisted."}`))
	if err != nil {
		t.Fatal(err)
	}

	domains := []string{"allowed.com", "*.allowed-mail.com"}
	allowMap, allowWildcards := makeDomainMap(domains)

	imAllow := &Importer{
		i18n:                  i18nInst,
		hasAllowlist:          true,
		hasAllowlistWildcards: allowWildcards,
		domainAllowlist:       allowMap,
	}

	blockDomains := []string{"blocked.com", "*.blocked-mail.com"}
	blockMap, blockWildcards := makeDomainMap(blockDomains)

	imBlock := &Importer{
		i18n:                  i18nInst,
		hasBlocklist:          true,
		hasBlocklistWildcards: blockWildcards,
		domainBlocklist:       blockMap,
	}

	// Allowlist tests
	if addr, err := imAllow.SanitizeEmail("user@allowed.com"); err != nil || addr != "user@allowed.com" {
		t.Errorf("SanitizeEmail(user@allowed.com) = (%q, %v); want (user@allowed.com, nil)", addr, err)
	}
	if addr, err := imAllow.SanitizeEmail("user@sub.allowed-mail.com"); err != nil || addr != "user@sub.allowed-mail.com" {
		t.Errorf("SanitizeEmail(user@sub.allowed-mail.com) = (%q, %v); want (user@sub.allowed-mail.com, nil)", addr, err)
	}
	if _, err := imAllow.SanitizeEmail("user@other.com"); err == nil {
		t.Errorf("SanitizeEmail(user@other.com) expected error for not being in allowlist")
	}

	// Blocklist tests
	if addr, err := imBlock.SanitizeEmail("user@good.com"); err != nil || addr != "user@good.com" {
		t.Errorf("SanitizeEmail(user@good.com) = (%q, %v); want (user@good.com, nil)", addr, err)
	}
	if _, err := imBlock.SanitizeEmail("user@blocked.com"); err == nil {
		t.Errorf("SanitizeEmail(user@blocked.com) expected error for being blocklisted")
	}
	if _, err := imBlock.SanitizeEmail("user@sub.blocked-mail.com"); err == nil {
		t.Errorf("SanitizeEmail(user@sub.blocked-mail.com) expected error for being blocklisted")
	}
}

func TestValidateFieldsNameGeneration(t *testing.T) {
	im := &Importer{}

	tests := []struct {
		inputEmail string
		inputName  string
		wantName   string
	}{
		{"john.doe@example.com", "", "John Doe"},
		{"jane_doe@example.com", "", "Jane_doe"},
		{"alexander@example.com", "", "Alexander"},
		{"custom.user@example.com", "Custom Name", "Custom Name"},
	}

	for _, tt := range tests {
		res, err := im.ValidateFields(SubReq{Email: tt.inputEmail, Name: tt.inputName})
		if err != nil {
			t.Fatalf("ValidateFields(%q, %q) error: %v", tt.inputEmail, tt.inputName, err)
		}
		if res.Name != tt.wantName {
			t.Errorf("ValidateFields(%q, %q).Name = %q; want %q", tt.inputEmail, tt.inputName, res.Name, tt.wantName)
		}
	}
}

func BenchmarkSanitizeEmail_DomainCheck(b *testing.B) {
	blockDomains := []string{"blocked.com"}
	blockMap, blockWildcards := makeDomainMap(blockDomains)
	im := &Importer{
		hasBlocklist:          true,
		hasBlocklistWildcards: blockWildcards,
		domainBlocklist:       blockMap,
	}
	email := "user@example.com"

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = im.SanitizeEmail(email)
	}
}

func BenchmarkValidateFields_DefaultName(b *testing.B) {
	im := &Importer{}
	req := SubReq{Email: "john.doe@example.com"}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = im.ValidateFields(req)
	}
}
