package assets

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"rollandplay/backend/internal/config"
)

// Store saves new uploads with the configured driver and serves assets saved by either driver,
// so a disk-to-S3 migration can run while the app is live.
type Store struct {
	Driver string
	Dir    string
	S3     *S3
}

// New builds the store; the S3 client is built whenever S3Endpoint, S3Bucket and both keys are set.
func New(cfg config.Config) (Store, error) {
	s := Store{Driver: cfg.AssetStorageDriver, Dir: cfg.AssetStorageDir}
	if s.Driver == "" {
		s.Driver = "disk"
	}
	if cfg.S3Configured() {
		client, err := NewS3(cfg.S3Endpoint, cfg.S3Region, cfg.S3Bucket, cfg.S3AccessKeyID, cfg.S3SecretAccessKey, cfg.S3PresignTTL)
		if err != nil {
			return Store{}, err
		}
		s.S3 = client
	}
	if s.Driver == "s3" && s.S3 == nil {
		return Store{}, config.ErrS3Incomplete
	}
	return s, nil
}

// Save writes the upload under id and returns the storage path recorded for the asset.
func (s Store) Save(ctx context.Context, id, contentType string, r io.Reader, size int64) (storagePath string, written int64, err error) {
	if s.Driver == "s3" {
		path, err := s.S3.Put(ctx, id, contentType, r, size)
		if err != nil {
			return "", 0, err
		}
		return path, size, nil
	}
	if err := os.MkdirAll(s.Dir, 0755); err != nil {
		return "", 0, err
	}
	path := filepath.Join(s.Dir, id)
	f, err := os.Create(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	n, err := io.Copy(f, r)
	return path, n, err
}

// Serve answers with the asset: S3 objects redirect to a presigned URL, disk files are streamed.
func (s Store) Serve(w http.ResponseWriter, r *http.Request, storagePath, contentType string) {
	if strings.HasPrefix(storagePath, "s3://") {
		if s.S3 == nil {
			writeError(w, 500, "storage", "S3 storage is not configured")
			return
		}
		u, err := s.S3.PresignedURL(r.Context(), storagePath)
		if err != nil {
			writeError(w, 500, "storage", err.Error())
			return
		}
		w.Header().Set("Cache-Control", "private, max-age=300")
		http.Redirect(w, r, u.String(), http.StatusFound)
		return
	}
	f, err := os.Open(storagePath)
	if errors.Is(err, fs.ErrNotExist) {
		writeError(w, 404, "not_found", "asset not found")
		return
	}
	if err != nil {
		writeError(w, 500, "storage", err.Error())
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		writeError(w, 500, "storage", err.Error())
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, r, "", stat.ModTime(), f)
}

// writeError mirrors httpapi.WriteError; httpapi imports this package, so it cannot be reused here.
func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
}
