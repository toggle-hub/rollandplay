package assets

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// S3 stores assets in a private S3-compatible bucket (Cloudflare R2 in production) and serves them
// through short-lived presigned URLs.
type S3 struct {
	client     *minio.Client
	bucket     string
	presignTTL time.Duration
}

func NewS3(endpoint, region, bucket, accessKey, secretKey string, ttl time.Duration) (*S3, error) {
	client, err := minio.New(endpoint, &minio.Options{Creds: credentials.NewStaticV4(accessKey, secretKey, ""), Secure: true, Region: region})
	if err != nil {
		return nil, fmt.Errorf("s3 client: %w", err)
	}
	return &S3{client: client, bucket: bucket, presignTTL: ttl}, nil
}

// Put uploads the object and returns its storage path, s3://bucket/key.
func (s *S3) Put(ctx context.Context, key, contentType string, r io.Reader, size int64) (string, error) {
	if _, err := s.client.PutObject(ctx, s.bucket, key, r, size, minio.PutObjectOptions{ContentType: contentType}); err != nil {
		return "", err
	}
	return "s3://" + s.bucket + "/" + key, nil
}

// PresignedURL returns a temporary GET URL for an s3://bucket/key storage path.
func (s *S3) PresignedURL(ctx context.Context, storagePath string) (*url.URL, error) {
	bucket, key, ok := strings.Cut(strings.TrimPrefix(storagePath, "s3://"), "/")
	if !strings.HasPrefix(storagePath, "s3://") || !ok || bucket == "" || key == "" {
		return nil, fmt.Errorf("invalid s3 storage path %q", storagePath)
	}
	return s.client.PresignedGetObject(ctx, bucket, key, s.presignTTL, nil)
}
