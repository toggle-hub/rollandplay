package logging

import (
	"fmt"
	"strings"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type Config struct {
	Level  string
	Format string
}

func New(cfg Config) (*zap.Logger, error) {
	level, err := parseLevel(cfg.Level)
	if err != nil {
		return nil, err
	}
	format := strings.ToLower(strings.TrimSpace(cfg.Format))
	if format == "" {
		format = "json"
	}
	if format != "json" && format != "console" {
		return nil, fmt.Errorf("LOG_FORMAT must be json or console")
	}

	encoder := zap.NewProductionEncoderConfig()
	encoder.TimeKey = "ts"
	encoder.EncodeTime = zapcore.ISO8601TimeEncoder
	encoder.EncodeDuration = zapcore.StringDurationEncoder

	zapCfg := zap.NewProductionConfig()
	zapCfg.Level = zap.NewAtomicLevelAt(level)
	zapCfg.Encoding = format
	zapCfg.EncoderConfig = encoder
	zapCfg.DisableStacktrace = level > zapcore.DebugLevel
	return zapCfg.Build()
}

func parseLevel(value string) (zapcore.Level, error) {
	if strings.TrimSpace(value) == "" {
		return zapcore.InfoLevel, nil
	}
	var level zapcore.Level
	if err := level.UnmarshalText([]byte(strings.ToLower(strings.TrimSpace(value)))); err != nil {
		return level, fmt.Errorf("LOG_LEVEL: %w", err)
	}
	return level, nil
}
