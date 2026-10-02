package main

import (
	"context"

	"go.uber.org/zap"

	"rollandplay/backend/internal/config"
	"rollandplay/backend/internal/db"
	"rollandplay/backend/internal/logging"
	"rollandplay/backend/migrations"
)

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
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("database connection failed", zap.Error(err))
	}
	defer pool.Close()
	if err := db.ApplyMigrations(ctx, pool, migrations.Files); err != nil {
		logger.Fatal("migrations failed", zap.Error(err))
	}
	logger.Info("migrations applied")
}
