// Package migrations embeds the forward-only goose SQL migrations.
//
// Every migration must follow expand/contract (ADR-0013): the schema produced
// by a release has to work with both the previous and the new application code.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
