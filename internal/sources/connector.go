// Connector sources (ADR-0035, #258): creating one, its settings and credentials, testing its connection, its syncs and
// the removals a sync holds for an editor. The runtime is internal/sourcesync; this file checks who is asking and
// records what they did.

package sources

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/sourcesync"
	"github.com/ncecere/grounded/internal/sourcetypes"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var (
	errNotConnector = apperr.Invalid("not_connector_source", "Only sources of a connector type have connector settings and syncs")
	errNotShared    = apperr.Invalid("type_not_shared", "A shared source can't be of this type")
	// errAccessFromProvider refuses a hand-set restriction on a source whose permissions come from its provider.
	errAccessFromProvider = apperr.Conflict("access_from_provider", "This source's permissions come from its provider and can't be set by hand")
)

// isConnector reports whether a source's type syncs through a connector (every syncing type but the web crawler).
func isConnector(typ string) bool {
	return typ != TypeWeb && sourcetypes.Of(typ).Sync
}

// connectorConfig validates a new connector source's settings and returns its stored configuration.
func (s *Service) connectorConfig(sc scope, in CreateInput) (json.RawMessage, error) {
	if s.Connectors == nil {
		return nil, apperr.Invalid("unsupported_type", "This server does not run connectors")
	}
	if sc.team == nil && !sourcetypes.Of(in.Type).Shared {
		return nil, errNotShared
	}
	settings := sourcesync.Settings{}
	if in.Connector != nil {
		settings = *in.Connector
	}
	return sourcesync.CheckSettings(in.Type, settings)
}

// attachConnector makes a just-inserted source a connector source and, unless it was imported, starts its first sync.
func (s *Service) attachConnector(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, src dbgen.DataSource, in CreateInput, start bool) (*dbgen.SourceSync, error) {
	settings := sourcesync.Settings{}
	if in.Connector != nil {
		settings = *in.Connector
	}
	if err := s.Connectors.Attach(ctx, q, src, settings, a.UserID); err != nil {
		return nil, err
	}
	if !start {
		return nil, nil
	}
	run, err := s.Connectors.StartSync(ctx, tx, src, sourcesync.TriggerCreate, true, a.UserID)
	if platform.IsMaintenance(err) {
		return nil, nil // the source is made; its first sync starts by hand or on schedule once maintenance ends
	} else if err != nil {
		return nil, err
	}
	return &run, nil
}

// connectorSource resolves a connector source for the actor.
func (s *Service) connectorSource(ctx context.Context, q *dbgen.Queries, sc scope, id uuid.UUID, lock bool) (dbgen.DataSource, error) {
	src, err := s.source(ctx, q, sc, id, lock)
	if err != nil {
		return src, err
	}
	if !isConnector(src.Type) || s.Connectors == nil {
		return src, errNotConnector
	}
	return src, nil
}

// SetConnector changes a connector source's settings, credentials or schedule (editors and up; If-Match on the source;
// audited as source.connector_update, with which parts changed and never a credential value). New settings or
// credentials make the next sync list everything again.
func (s *Service) SetConnector(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID, in sourcesync.Settings, expectedRevision int64) (Summary, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return Summary{}, err
	}
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.connectorSource(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		ch, err := s.Connectors.Update(ctx, q, cur, in, a.UserID)
		if err != nil || !(ch.Config || ch.Credentials || ch.Schedule) {
			return err // nothing to change: no write, no new revision, no audit entry
		}
		if _, err := q.SetSourceConfig(ctx, dbgen.SetSourceConfigParams{ID: id, Config: ch.Stored}); err != nil {
			return err
		}
		e := a.Audit("source.connector_update", "data_source", id.String())
		e.TeamID = sc.auditTeam()
		e.Metadata = audit.MergeMeta(e.Metadata, map[string]any{"settings": ch.Config, "credentials": ch.Credentials, "schedule": ch.Schedule})
		if ch.Config {
			e.Before, e.After = map[string]any{"config": cur.Config}, map[string]any{"config": ch.Stored}
		}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return Summary{}, err
	}
	src, err := s.q.GetSource(ctx, id)
	if err != nil {
		return Summary{}, err
	}
	return s.summary(ctx, src)
}

// CheckConnection tests a connector source's connection with its stored settings and credentials, with try laid over
// them when set (editors and up). Nothing is saved.
func (s *Service) CheckConnection(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID, try *sourcesync.Settings) (connector.CheckResult, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return connector.CheckResult{}, err
	}
	src, err := s.connectorSource(ctx, s.q, sc, id, false)
	if err != nil {
		return connector.CheckResult{}, err
	}
	return s.Connectors.Check(ctx, src, try)
}

// CheckNewConnection tests settings and credentials for a source that does not exist yet (editors and up), so the form
// can offer what the credential reaches. The type must be on.
func (s *Service) CheckNewConnection(ctx context.Context, a authz.Actor, o Owner, typ string, try sourcesync.Settings) (connector.CheckResult, error) {
	if _, err := s.access(ctx, a, o, true); err != nil {
		return connector.CheckResult{}, err
	}
	if !isConnector(typ) || s.Connectors == nil {
		return connector.CheckResult{}, errNotConnector
	}
	if on, err := platform.SourceTypeEnabled(ctx, s.q, typ); err != nil {
		return connector.CheckResult{}, err
	} else if !on {
		return connector.CheckResult{}, errTypeOff
	}
	return s.Connectors.Check(ctx, dbgen.DataSource{Type: typ, Config: json.RawMessage(`{}`)}, &try)
}

// StartSync starts a sync of a connector source (trigger "manual"; full lists everything again). When one is active it
// returns *sourcesync.InProgressError carrying it.
func (s *Service) StartSync(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID, full bool) (dbgen.SourceSync, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return dbgen.SourceSync{}, err
	}
	var out dbgen.SourceSync
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		src, err := s.connectorSource(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		if out, err = s.Connectors.StartSync(ctx, tx, src, sourcesync.TriggerManual, full, a.UserID); err != nil {
			return err
		}
		e := a.Audit("source.sync", "data_source", id.String())
		e.TeamID, e.Metadata = sc.auditTeam(), audit.MergeMeta(e.Metadata, map[string]any{"syncId": out.ID.String(), "full": full})
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// Syncs lists a connector source's syncs, newest first.
func (s *Service) Syncs(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID, limit int32) ([]dbgen.SourceSync, error) {
	sc, err := s.readAccess(ctx, a, o, sourceRead(breakglass.ReadCrawls, id))
	if err != nil {
		return nil, err
	}
	if _, err := s.connectorSource(ctx, s.q, sc, id, false); err != nil {
		return nil, err
	}
	return s.Connectors.ListSyncs(ctx, id, limit)
}

// CancelSync cancels an active sync.
func (s *Service) CancelSync(ctx context.Context, a authz.Actor, o Owner, sourceID, syncID uuid.UUID) (dbgen.SourceSync, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return dbgen.SourceSync{}, err
	}
	var out dbgen.SourceSync
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if _, err := s.connectorSource(ctx, q, sc, sourceID, true); err != nil {
			return err
		}
		var err error
		if out, err = s.Connectors.CancelSync(ctx, q, sourceID, syncID); err != nil {
			return err
		}
		e := a.Audit("source.sync_cancel", "data_source", sourceID.String())
		e.TeamID, e.Metadata = sc.auditTeam(), audit.MergeMeta(e.Metadata, map[string]any{"syncId": syncID.String()})
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// HeldRemovals shows what a sync's held removals would remove: the sync and the first documents (editors and up, who
// decide it; names only).
func (s *Service) HeldRemovals(ctx context.Context, a authz.Actor, o Owner, sourceID, syncID uuid.UUID) (dbgen.SourceSync, []dbgen.SyncRemovalSampleRow, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return dbgen.SourceSync{}, nil, err
	}
	if _, err := s.connectorSource(ctx, s.q, sc, sourceID, false); err != nil {
		return dbgen.SourceSync{}, nil, err
	}
	return s.Connectors.HeldRemovals(ctx, sourceID, syncID, 100)
}

// DecideRemovals confirms or dismisses a sync's held removals (editors and up; audited as source.removals_confirm or
// source.removals_dismiss with the number of documents).
func (s *Service) DecideRemovals(ctx context.Context, a authz.Actor, o Owner, sourceID, syncID uuid.UUID, confirm bool) (dbgen.SourceSync, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return dbgen.SourceSync{}, err
	}
	var out dbgen.SourceSync
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		src, err := s.connectorSource(ctx, q, sc, sourceID, true)
		if err != nil {
			return err
		}
		held, err := q.GetSourceSync(ctx, syncID)
		if err != nil && store.NotFound(err) != store.ErrNotFound {
			return err
		}
		if out, err = s.Connectors.DecideRemovals(ctx, q, src, syncID, confirm); err != nil {
			return err
		}
		action := "source.removals_dismiss"
		if confirm {
			action = "source.removals_confirm"
		}
		e := a.Audit(action, "data_source", sourceID.String())
		e.TeamID = sc.auditTeam()
		e.Metadata = audit.MergeMeta(e.Metadata, map[string]any{"syncId": syncID.String(), "documents": held.RemovalsPending})
		return audit.Record(ctx, q, e)
	})
	return out, err
}
