package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr          string
	MetricsAddr       string
	PublicBaseURL     string
	APIBaseURL        string
	DatabaseURL       string
	RedisAddr         string
	RedisPassword     string
	SessionCookieName string
	SessionTTL        time.Duration // how long a sign-in lasts without use: the refresh token's lifetime
	AccessTTL         time.Duration // lifetime of the access token sent with every request
	MagicLinkTTL      time.Duration
	SMTPAddr          string
	SMTPFrom          string
	SMTPUsername      string
	SMTPPassword      string
	AssetStorageDir   string
	// AssetStorageDriver picks where new uploads go: "disk" or "s3".
	AssetStorageDriver string
	S3Endpoint         string // host only, e.g. <account>.r2.cloudflarestorage.com
	S3Region           string
	S3Bucket           string
	S3AccessKeyID      string
	S3SecretAccessKey  string
	S3PresignTTL       time.Duration
	RoomPasswordSalt   string
	LogLevel           string
	LogFormat          string
}

func Load() (Config, error) {
	_ = loadDotEnv(".env")
	c := Config{
		HTTPAddr:           env("HTTP_ADDR", ":8080"),
		MetricsAddr:        env("METRICS_ADDR", "127.0.0.1:9464"),
		PublicBaseURL:      env("PUBLIC_BASE_URL", "http://localhost:5173"),
		APIBaseURL:         env("API_BASE_URL", "http://localhost:8080"),
		DatabaseURL:        env("DATABASE_URL", "postgres://rollandplay:rollandplay@localhost:5432/rollandplay?sslmode=disable"),
		RedisAddr:          env("REDIS_ADDR", "localhost:6379"),
		RedisPassword:      env("REDIS_PASSWORD", ""),
		SessionCookieName:  env("SESSION_COOKIE_NAME", "rollandplay_session"),
		SMTPAddr:           env("SMTP_ADDR", "localhost:1025"),
		SMTPFrom:           env("SMTP_FROM", "rollandplay@localhost"),
		SMTPUsername:       env("SMTP_USERNAME", ""),
		SMTPPassword:       env("SMTP_PASSWORD", ""),
		AssetStorageDir:    env("ASSET_STORAGE_DIR", "./var/assets"),
		AssetStorageDriver: env("ASSET_STORAGE_DRIVER", "disk"),
		S3Endpoint:         strings.TrimSuffix(strings.TrimPrefix(env("S3_ENDPOINT", ""), "https://"), "/"),
		S3Region:           env("S3_REGION", "auto"),
		S3Bucket:           env("S3_BUCKET", ""),
		S3AccessKeyID:      env("S3_ACCESS_KEY_ID", ""),
		S3SecretAccessKey:  env("S3_SECRET_ACCESS_KEY", ""),
		RoomPasswordSalt:   env("ROOM_PASSWORD_SALT", "dev-only-salt"),
		LogLevel:           env("LOG_LEVEL", "info"),
		LogFormat:          env("LOG_FORMAT", "json"),
	}
	sh, err := strconv.Atoi(env("SESSION_TTL_HOURS", "720"))
	if err != nil {
		return c, fmt.Errorf("SESSION_TTL_HOURS: %w", err)
	}
	at, err := strconv.Atoi(env("ACCESS_TOKEN_TTL_MINUTES", "15"))
	if err != nil || at <= 0 {
		return c, fmt.Errorf("ACCESS_TOKEN_TTL_MINUTES must be a positive number of minutes")
	}
	ml, err := strconv.Atoi(env("MAGIC_LINK_TTL_MINUTES", "15"))
	if err != nil {
		return c, fmt.Errorf("MAGIC_LINK_TTL_MINUTES: %w", err)
	}
	c.SessionTTL = time.Duration(sh) * time.Hour
	c.AccessTTL = time.Duration(at) * time.Minute
	c.MagicLinkTTL = time.Duration(ml) * time.Minute
	pt, err := strconv.Atoi(env("S3_PRESIGN_TTL_MINUTES", "15"))
	if err != nil {
		return c, fmt.Errorf("S3_PRESIGN_TTL_MINUTES: %w", err)
	}
	c.S3PresignTTL = time.Duration(pt) * time.Minute
	switch c.AssetStorageDriver {
	case "disk":
	case "s3":
		if !c.S3Configured() {
			return c, ErrS3Incomplete
		}
	default:
		return c, fmt.Errorf("ASSET_STORAGE_DRIVER must be disk or s3")
	}
	if c.RoomPasswordSalt == "" && !(strings.Contains(c.PublicBaseURL, "localhost") || strings.Contains(c.PublicBaseURL, "127.0.0.1")) {
		return c, fmt.Errorf("ROOM_PASSWORD_SALT is required outside localhost")
	}
	return c, nil
}

// ErrS3Incomplete reports that S3 storage was requested without its connection settings.
var ErrS3Incomplete = errors.New("ASSET_STORAGE_DRIVER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY")

// S3Configured reports whether every setting needed to reach the S3 bucket is present.
func (c Config) S3Configured() bool {
	return c.S3Endpoint != "" && c.S3Bucket != "" && c.S3AccessKeyID != "" && c.S3SecretAccessKey != ""
}

func env(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}

func loadDotEnv(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key != "" && os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
	}
	return scanner.Err()
}
