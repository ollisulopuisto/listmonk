package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestHashAPIToken(t *testing.T) {
	tests := []struct {
		token string
	}{
		{token: "test-token"},
		{token: "secret_1234567890_api_key_xyz"},
		{token: ""},
	}

	for _, tt := range tests {
		got := HashAPIToken(tt.token)

		// Calculate expected value manually
		h := sha256.New()
		h.Write([]byte(tt.token))
		want := hex.EncodeToString(h.Sum(nil))

		if got != want {
			t.Errorf("HashAPIToken(%q) = %q; want %q", tt.token, got, want)
		}
	}
}
