package ingest

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
)

// RefillWith exposes refill to the integration tests, with the River
// client a job would find in its context.
func (p *Processor) RefillWith(ctx context.Context, tx pgx.Tx, client *river.Client[pgx.Tx]) error {
	return p.refillWith(ctx, tx, client)
}
