package filesystem

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/knadh/listmonk/internal/media"
)

// Opts represents filesystem params
type Opts struct {
	UploadPath string `koanf:"upload_path"`
	UploadURI  string `koanf:"upload_uri"`
	RootURL    string `koanf:"root_url"`
}

// Client implements `media.Store`
type Client struct {
	opts Opts
}

// New initialises store for Filesystem provider.
func New(opts Opts) (media.Store, error) {
	return &Client{
		opts: opts,
	}, nil
}

// Put accepts the filename, the content type and file object itself and stores the file in disk.
func (c *Client) Put(filename string, cType string, src io.ReadSeeker) (string, error) {
	fPath, err := c.resolvePath(filename)
	if err != nil {
		return "", err
	}

	// Ensure the directory exists.
	if err := os.MkdirAll(filepath.Dir(fPath), 0755); err != nil {
		return "", err
	}

	// Read the file contents.
	out, err := os.OpenFile(fPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0664)
	if err != nil {
		return "", err
	}
	defer out.Close()

	// Copy it to the target location.
	if _, err := io.Copy(out, src); err != nil {
		return "", err
	}

	return filename, nil
}

// GetURL accepts a filename and retrieves the full path from disk.
func (c *Client) GetURL(name string) string {
	return fmt.Sprintf("%s%s/%s", c.opts.RootURL, c.opts.UploadURI, name)
}

// GetBlob accepts a key (relative path), reads the file, and returns the blob.
func (c *Client) GetBlob(key string) ([]byte, error) {
	fPath, err := c.resolvePath(key)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(fPath)
}

// Delete accepts a filename and removes it from disk.
func (c *Client) Delete(file string) error {
	fPath, err := c.resolvePath(file)
	if err != nil {
		return err
	}
	return os.Remove(fPath)
}

// resolvePath joins the upload directory with the given key and rejects the
// request if the resolved path escapes the upload directory. This prevents
// path traversal via keys such as "../".
func (c *Client) resolvePath(key string) (string, error) {
	dir := getDir(c.opts.UploadPath)

	fPath := filepath.Join(dir, key)
	abs, err := filepath.Abs(fPath)
	if err != nil {
		return "", err
	}

	absDir, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}

	// The resolved path must be the upload directory itself or live inside it.
	// The separator boundary avoids matching a sibling directory such as
	// "/tmp/foo-bar" when the upload dir is "/tmp/foo".
	if abs != absDir && !strings.HasPrefix(abs, absDir+string(os.PathSeparator)) {
		return "", fmt.Errorf("path %q escapes the upload directory", key)
	}

	return abs, nil
}

// getDir returns the current working directory path if no directory is specified,
// else returns the directory path specified itself.
func getDir(dir string) string {
	if dir == "" {
		dir, _ = os.Getwd()
	}

	return dir
}
