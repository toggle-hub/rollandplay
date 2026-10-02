package email

import (
	"context"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Sender struct {
	Redis    *redis.Client
	SMTPAddr string
	From     string
	Username string
	Password string
	Logger   *zap.Logger
}

func Enqueue(ctx context.Context, rdb *redis.Client, to, subject, url string) error {
	return rdb.XAdd(ctx, &redis.XAddArgs{Stream: "email_jobs", Values: map[string]any{"to": to, "subject": subject, "url": url}}).Err()
}

func (s Sender) Run(ctx context.Context) {
	logger := s.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	logger.Info("email worker started", zap.String("smtp_addr", s.SMTPAddr))
	defer logger.Info("email worker stopped")
	last := "$"
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		streams, err := s.Redis.XRead(ctx, &redis.XReadArgs{Streams: []string{"email_jobs", last}, Count: 10, Block: time.Second}).Result()
		if err != nil && err != redis.Nil {
			logger.Warn("email queue read failed", zap.Error(err))
			time.Sleep(time.Second)
			continue
		}
		for _, stream := range streams {
			for _, msg := range stream.Messages {
				last = msg.ID
				to := fmt.Sprint(msg.Values["to"])
				subject := fmt.Sprint(msg.Values["subject"])
				if err := s.Send(to, subject, fmt.Sprint(msg.Values["url"])); err != nil {
					logger.Error("email send failed", zap.String("job_id", msg.ID), zap.String("to_domain", domain(to)), zap.Error(err))
					continue
				}
				logger.Info("email sent", zap.String("job_id", msg.ID), zap.String("to_domain", domain(to)), zap.String("subject", subject))
			}
		}
	}
}

func domain(email string) string {
	_, d, ok := strings.Cut(email, "@")
	if !ok {
		return ""
	}
	return d
}

func (s Sender) Send(to, subject, url string) error {
	body := "From: " + s.From + "\r\nTo: " + to + "\r\nSubject: " + subject + "\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOpen this Rollandplay sign-in link:\r\n" + url + "\r\n"
	return smtp.SendMail(s.SMTPAddr, s.auth(), s.envelopeFrom(), []string{to}, []byte(body))
}

func (s Sender) auth() smtp.Auth {
	if s.Username == "" || s.Password == "" {
		return nil
	}
	host, _, err := net.SplitHostPort(s.SMTPAddr)
	if err != nil {
		host = s.SMTPAddr
	}
	return smtp.PlainAuth("", s.Username, s.Password, host)
}

func (s Sender) envelopeFrom() string {
	addr, err := mail.ParseAddress(s.From)
	if err != nil {
		return s.From
	}
	return addr.Address
}
