package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"rollandplay/backend/internal/auth"
	"rollandplay/backend/internal/config"
	"rollandplay/backend/internal/db"
	"rollandplay/backend/internal/email"
	"rollandplay/backend/internal/httpapi"
	"rollandplay/backend/internal/logging"
	"rollandplay/backend/internal/telemetry"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
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
	metricsHandler, shutdownMetrics, err := telemetry.Setup()
	if err != nil {
		logger.Fatal("telemetry setup failed", zap.Error(err))
	}
	defer func() {
		if err := shutdownMetrics(context.Background()); err != nil {
			logger.Warn("telemetry shutdown failed", zap.Error(err))
		}
	}()
	metricsMux := http.NewServeMux()
	metricsMux.Handle("GET /metrics", metricsHandler)
	metricsSrv := &http.Server{Addr: cfg.MetricsAddr, Handler: metricsMux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		logger.Info("metrics listening", zap.String("metrics_addr", cfg.MetricsAddr))
		if err := metricsSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("metrics server failed", zap.Error(err))
		}
	}()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("database connection failed", zap.Error(err))
	}
	defer pool.Close()
	logger.Info("database connected")
	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr, Password: cfg.RedisPassword})
	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Fatal("redis connection failed", zap.String("addr", cfg.RedisAddr), zap.Error(err))
	}
	defer rdb.Close()
	logger.Info("redis connected", zap.String("addr", cfg.RedisAddr))
	auth.Init(pool, rdb, cfg)
	go email.Sender{Redis: rdb, SMTPAddr: cfg.SMTPAddr, From: cfg.SMTPFrom, Username: cfg.SMTPUsername, Password: cfg.SMTPPassword, Logger: logger.Named("email")}.Run(ctx)
	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: httpapi.NewWithLogger(pool, rdb, cfg, logger).Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		logger.Info("shutdown requested")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			logger.Error("server shutdown failed", zap.Error(err))
		}
		_ = metricsSrv.Shutdown(shutdownCtx)
	}()
	logger.Info("rollandplay backend listening", zap.String("http_addr", cfg.HTTPAddr), zap.String("public_base_url", cfg.PublicBaseURL), zap.String("api_base_url", cfg.APIBaseURL), zap.String("asset_storage_dir", cfg.AssetStorageDir))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal("server failed", zap.Error(err))
	}
	logger.Info("server stopped")
}
