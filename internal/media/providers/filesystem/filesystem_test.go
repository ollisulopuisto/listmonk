package filesystem

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestGetBlobRejectsPathTraversal(t *testing.T) {
	dir := t.TempDir()
	safeName := "safe.txt"
	secretName := "secret.txt"

	// In-directory file.
	if err := os.WriteFile(filepath.Join(dir, safeName), []byte("safe-content"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	// File outside the upload directory that must never be readable.
	secret := filepath.Join(dir, "..", secretName)
	if err := os.WriteFile(secret, []byte("secret-content"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	defer func() { _ = os.Remove(secret) }()

	c := &Client{opts: Opts{UploadPath: dir}}

	// Traversal attempts must not escape the upload directory.
	traversals := []string{
		"../" + secretName,
		"../../" + secretName,
		filepath.Join("..", "..", secretName),
		safeName + "/../../" + secretName,
	}
	for _, key := range traversals {
		if _, err := c.GetBlob(key); err == nil {
			t.Errorf("GetBlob(%q) should reject path traversal", key)
		}
	}

	// A regular in-directory key must still work.
	got, err := c.GetBlob(safeName)
	if err != nil {
		t.Fatalf("GetBlob(%q) failed: %v", safeName, err)
	}
	if string(got) != "safe-content" {
		t.Errorf("GetBlob(%q) = %q; want %q", safeName, got, "safe-content")
	}
}

func TestPutRejectsPathTraversal(t *testing.T) {
	dir := t.TempDir()
	c := &Client{opts: Opts{UploadPath: dir}}

	content := []byte("traversal-attempt")
	if _, err := c.Put("../../evil.txt", "text/plain", newReadSeeker(content)); err == nil {
		t.Error("Put should reject path traversal filename")
	}

	// Outside-file must not have been created.
	evil := filepath.Join(dir, "..", "evil.txt")
	if _, err := os.Stat(evil); err == nil {
		t.Error("evil.txt was written outside the upload directory")
	}
}

func TestDeleteRejectsPathTraversal(t *testing.T) {
	dir := t.TempDir()
	c := &Client{opts: Opts{UploadPath: dir}}

	if err := c.Delete("../../evil.txt"); err == nil {
		t.Error("Delete should reject path traversal filename")
	}
}

func TestResolvePathRejectsAbsoluteAndBackslashTraversal(t *testing.T) {
	dir := t.TempDir()
	c := &Client{opts: Opts{UploadPath: dir}}

	for _, key := range []string{
		"/etc/passwd",
		"..\\..\\evil.txt",
		"sub/..\\..\\evil.txt",
	} {
		if _, err := c.GetBlob(key); err == nil {
			t.Errorf("GetBlob(%q) should be rejected", key)
		}
	}

	// Keys that clean to an in-directory path keep working.
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0755); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "file.txt"), []byte("x"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if _, err := c.GetBlob("sub//file.txt"); err != nil {
		t.Errorf("GetBlob(%q) should resolve inside the upload dir: %v", "sub//file.txt", err)
	}
}

type readSeeker struct {
	*bytes.Reader
}

func newReadSeeker(b []byte) *readSeeker {
	return &readSeeker{Reader: bytes.NewReader(b)}
}
