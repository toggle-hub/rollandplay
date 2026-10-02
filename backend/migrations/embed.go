package migrations

import "embed"

// Files embeds SQL migrations in filename order.
//
//go:embed *.sql
var Files embed.FS
