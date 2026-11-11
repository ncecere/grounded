package app

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/sourcesync"
)

// wireConnectors builds the connector runtime (ADR-0035) and gives it to the sources. It runs after the webhooks exist,
// which hear of finished and failed syncs.
func wireConnectors(s *Services, cfg config.Config, pool *pgxpool.Pool, jobsClient *jobs.Client, store blob.Store, box *secrets.Box, log *slog.Logger) {
	// Connectors reach public addresses only, like the crawler. No setting lifts that (the configuration tests refuse
	// one): how a platform admin allows one self-hosted host is decided with the first connector that needs it.
	client := connector.NewHTTPClient(connector.Outbound{AllowPrivate: cfg.Connectors.AllowPrivateAddressesForTests})
	s.Connectors = sourcesync.New(pool, jobsClient, store, box, client, cfg.MaxUploadBytes, log)
	s.Connectors.HoldPercent = cfg.Connectors.RemovalHoldPercent
	s.Connectors.Limits, s.Connectors.Webhooks, s.Connectors.Maintenance = s.Limits, s.Webhooks, s.Platform.Gate
	s.Sources.Connectors = s.Connectors
}
