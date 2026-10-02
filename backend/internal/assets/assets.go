package assets

import (
	"io"
	"os"
	"path/filepath"
)

type Store struct{ Dir string }

func (s Store) Save(id string, r io.Reader) (string, int64, error) {
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
