// Package db embeds the SQL migrations so the binary can migrate without the source tree.
package db

import "embed"

// Migrations holds db/migrations/*.sql (goose format).
//
//go:embed migrations/*.sql
var Migrations embed.FS
