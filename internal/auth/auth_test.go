package auth

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
	"gopkg.in/volatiletech/null.v6"
)

func TestHashAPIToken(t *testing.T) {
	tests := []string{
		"test-token",
		"secret_1234567890_api_key_xyz",
		"a",
	}

	for _, token := range tests {
		hashed := HashAPIToken(token)

		if err := bcrypt.CompareHashAndPassword([]byte(hashed), []byte(token)); err != nil {
			t.Errorf("bcrypt.CompareHashAndPassword failed for token %q: %v", token, err)
		}
	}
}

func TestGetAPIToken(t *testing.T) {
	username := "testuser"
	token := "my-secret-token"

	a := &Auth{
		apiUsers: map[string]User{
			username: {
				Username: username,
				Password: null.String{String: HashAPIToken(token), Valid: true},
			},
		},
	}

	// Test valid credentials
	user, ok := a.GetAPIToken(username, token)
	if !ok {
		t.Fatalf("GetAPIToken failed with valid credentials")
	}
	if user.Username != username {
		t.Errorf("expected username %q, got %q", username, user.Username)
	}

	// Test invalid token
	_, ok = a.GetAPIToken(username, "wrong-token")
	if ok {
		t.Errorf("GetAPIToken succeeded with wrong token")
	}

	// Test unknown user
	_, ok = a.GetAPIToken("unknownuser", token)
	if ok {
		t.Errorf("GetAPIToken succeeded with unknown user")
	}
}
