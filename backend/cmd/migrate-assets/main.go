// Command migrate-assets copies disk-stored assets into the configured S3 bucket and repoints
// their rows at the uploaded objects. Local files are kept; re-runs only touch rows still on disk.
package main

import (
	"context"
	"errors"
	"io/fs"
	"os"

	"go.uber.org/zap"

	"rollandplay/backend/internal/assets"
	"rollandplay/backend/internal/config"
	"rollandplay/backend/internal/db"
	"rollandplay/backend/internal/logging"
)

type diskAsset struct{ id, path, mime string }

func main() {
	ctx := context.Background()
	baseLogger, err := logging.New(logging.Config{})
	if err != nil {
		panic(err)
	}
	defer baseLogger.Sync()
	cfg, err := config.Load()
	if err != nil {
		baseLogger.Fatal("configuration failed", zap.Error(err))
	}
	logger, err := logging.New(logging.Config{Level: cfg.LogLevel, Format: cfg.LogFormat})
	if err != nil {
		baseLogger.Fatal("logger configuration failed", zap.Error(err))
	}
	defer logger.Sync()
	store, err := assets.New(cfg)
	if err != nil {
		logger.Fatal("asset storage setup failed", zap.Error(err))
	}
	if store.S3 == nil {
		logger.Fatal("asset storage setup failed", zap.Error(config.ErrS3Incomplete))
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("database connection failed", zap.Error(err))
	}
	defer pool.Close()

	rows, err := pool.Query(ctx, `select id::text,storage_path,mime_type from assets where storage_path not like 's3://%' order by created_at`)
	if err != nil {
		logger.Fatal("listing disk assets failed", zap.Error(err))
	}
	var pending []diskAsset
	for rows.Next() {
		var a diskAsset
		if err := rows.Scan(&a.id, &a.path, &a.mime); err != nil {
			rows.Close()
			logger.Fatal("reading disk assets failed", zap.Error(err))
		}
		pending = append(pending, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		logger.Fatal("reading disk assets failed", zap.Error(err))
	}

	var migrated, skipped, failed int
	for _, a := range pending {
		log := logger.With(zap.String("asset_id", a.id), zap.String("storage_path", a.path))
		newPath, err := upload(ctx, store.S3, a)
		if errors.Is(err, fs.ErrNotExist) {
			log.Warn("asset file missing, skipped")
			skipped++
			continue
		}
		if err != nil {
			log.Error("asset upload failed", zap.Error(err))
			failed++
			continue
		}
		if _, err := pool.Exec(ctx, `update assets set storage_path=$2 where id=$1 and storage_path=$3`, a.id, newPath, a.path); err != nil {
			log.Error("asset row update failed", zap.Error(err))
			failed++
			continue
		}
		log.Info("asset migrated", zap.String("new_storage_path", newPath))
		migrated++
	}
	logger.Info("asset migration finished", zap.Int("migrated", migrated), zap.Int("skipped", skipped), zap.Int("failed", failed))
	if failed > 0 {
		logger.Sync()
		os.Exit(1)
	}
}

func upload(ctx context.Context, s3 *assets.S3, a diskAsset) (string, error) {
	f, err := os.Open(a.path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return "", err
	}
	return s3.Put(ctx, a.id, a.mime, f, stat.Size())
}
