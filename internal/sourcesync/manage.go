package sourcesync

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/access"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/sourcetypes"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// State is a connector source's side of a source: its schedule, whether credentials are stored, and its syncs.
type State struct {
	Schedule string
	// CredentialKeys are the credential fields that have a stored value (never the values).
	CredentialKeys   []string
	CredentialsSetAt *time.Time
	LastCompleteAt   *time.Time
	// Available: this build has the type's connector.
	Available bool
	// Active is the queued or running sync, and Held the latest sync whose removals wait for an editor.
	Active, Held *dbgen.SourceSync
}

// Attach makes src a connector source inside the transaction that inserted it: its row, its sealed credentials and its
// schedule. in was validated by CheckSettings. A type that reports permissions needs the Document permissions switch on.
func (s *Service) Attach(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, in Settings, by uuid.UUID) error {
	if sourcetypes.Of(src.Type).Permissions == sourcetypes.PermissionsProvider {
		if st, err := q.GetDocumentAccessSettings(ctx); err != nil {
			return err
		} else if !st.Enabled {
			return access.ErrOff
		}
	}
	schedule := in.Schedule
	if schedule == "" {
		schedule = ScheduleManual
	}
	if _, err := q.InsertSourceConnector(ctx, dbgen.InsertSourceConnectorParams{ID: src.ID, Schedule: schedule}); err != nil {
		return err
	}
	cipher, err := s.seal(src.ID, merge(nil, in.Credentials))
	if err != nil {
		return err
	}
	if cipher != nil {
		if _, err := q.SetSourceCredentials(ctx, dbgen.SetSourceCredentialsParams{ID: src.ID, CredentialsCipher: cipher, SetBy: nullUUID(by)}); err != nil {
			return err
		}
	}
	return q.SetNextSync(ctx, dbgen.SetNextSyncParams{ID: src.ID, NextSyncAt: nextSync(schedule, s.now())})
}

// Change is what Update did, for the audit entry (never a credential value).
type Change struct {
	Config, Credentials, Schedule bool
	// Stored is the configuration as stored now.
	Stored json.RawMessage
}

// Update changes a connector source's settings inside the caller's transaction, which holds the source row's lock. New
// settings or credentials change what the source selects, so the saved cursor is dropped and the next sync lists
// everything. It does not write data_sources.config: the caller stores Change.Stored with the rest of its update.
func (s *Service) Update(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, in Settings, by uuid.UUID) (Change, error) {
	out := Change{Stored: src.Config}
	c, err := connectorFor(src.Type)
	if err != nil {
		return out, err
	}
	t, _ := sourcetypes.Get(src.Type)
	stored, row, err := s.credentials(ctx, q, src.ID)
	if err != nil {
		return out, err
	}
	if len(in.Config) > 0 && string(in.Config) != "null" {
		cfg, err := normalConfig(c, in.Config)
		if err != nil {
			return out, err
		}
		if !sameJSON(cfg, src.Config) {
			out.Config, out.Stored = true, cfg
		}
	}
	if len(in.Credentials) > 0 {
		if err := checkCredentials(t, in.Credentials, false); err != nil {
			return out, err
		}
		next := merge(stored, in.Credentials)
		if err := checkCredentials(t, next, true); err != nil {
			return out, err
		}
		cipher, err := s.seal(src.ID, next)
		if err != nil {
			return out, err
		}
		if _, err := q.SetSourceCredentials(ctx, dbgen.SetSourceCredentialsParams{ID: src.ID, CredentialsCipher: cipher, SetBy: nullUUID(by)}); err != nil {
			return out, err
		}
		out.Credentials = true
	}
	if in.Schedule != "" && in.Schedule != row.Schedule {
		if !ValidSchedule(in.Schedule) {
			return out, apperr.Invalid("invalid_schedule", "The schedule is manual, hourly, daily or weekly")
		}
		if _, err := q.SetSourceSchedule(ctx, dbgen.SetSourceScheduleParams{ID: src.ID, Schedule: in.Schedule}); err != nil {
			return out, err
		}
		if err := q.SetNextSync(ctx, dbgen.SetNextSyncParams{ID: src.ID, NextSyncAt: nextSync(in.Schedule, s.now()), LastSyncAt: src.LastSyncAt}); err != nil {
			return out, err
		}
		out.Schedule = true
	}
	if out.Config || out.Credentials {
		return out, q.ClearSourceCursor(ctx, src.ID)
	}
	return out, nil
}

func sameJSON(a, b json.RawMessage) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	ax, _ := json.Marshal(x)
	by, _ := json.Marshal(y)
	return string(ax) == string(by)
}

// States reads the connector side of sources (those without one are absent from the result).
func (s *Service) States(ctx context.Context, sources []dbgen.DataSource) (map[uuid.UUID]State, error) {
	ids := make([]uuid.UUID, 0, len(sources))
	for _, src := range sources {
		if !sourcetypes.Of(src.Type).Sync || src.Type == sourcetypes.Web {
			continue
		}
		ids = append(ids, src.ID)
	}
	out := map[uuid.UUID]State{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.q.SourceConnectorsByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	types := map[uuid.UUID]string{}
	for _, src := range sources {
		types[src.ID] = src.Type
	}
	for _, r := range rows {
		st := State{Schedule: r.Schedule, CredentialsSetAt: r.CredentialsSetAt, LastCompleteAt: r.LastCompleteAt, CredentialKeys: []string{}}
		_, st.Available = connector.Get(types[r.ID])
		if creds, err := s.open(r.ID, r.CredentialsCipher); err == nil {
			for _, f := range fieldsOf(types[r.ID]) {
				if creds[f.Key] != "" {
					st.CredentialKeys = append(st.CredentialKeys, f.Key)
				}
			}
		}
		out[r.ID] = st
	}
	active, err := s.q.ActiveSourceSyncs(ctx, ids)
	if err != nil {
		return nil, err
	}
	for i := range active {
		st := out[active[i].SourceID]
		st.Active = &active[i]
		out[active[i].SourceID] = st
	}
	held, err := s.q.HeldSourceSyncs(ctx, ids)
	if err != nil {
		return nil, err
	}
	for i := range held {
		st := out[held[i].SourceID]
		if st.Held == nil {
			st.Held = &held[i]
			out[held[i].SourceID] = st
		}
	}
	return out, nil
}

func fieldsOf(typ string) []sourcetypes.Field {
	t, _ := sourcetypes.Get(typ)
	return t.Credentials
}

// Check tests a connection: the source's stored settings and credentials, with try laid over them when it is set (so a
// form can be tested before it is saved). src.ID may be uuid.Nil for a source that does not exist yet.
func (s *Service) Check(ctx context.Context, src dbgen.DataSource, try *Settings) (connector.CheckResult, error) {
	c, err := connectorFor(src.Type)
	if err != nil {
		return connector.CheckResult{}, err
	}
	creds := map[string]string{}
	if src.ID != uuid.Nil {
		if creds, _, err = s.credentials(ctx, s.q, src.ID); err != nil {
			return connector.CheckResult{}, err
		}
	}
	if try != nil {
		t, _ := sourcetypes.Get(src.Type)
		if err := checkCredentials(t, try.Credentials, false); err != nil {
			return connector.CheckResult{}, err
		}
		creds = merge(creds, try.Credentials)
		if len(try.Config) > 0 && string(try.Config) != "null" {
			if src.Config, err = normalConfig(c, try.Config); err != nil {
				return connector.CheckResult{}, err
			}
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	res, err := c.Check(ctx, s.env(ctx, src, creds))
	if err != nil {
		code, msg := "connection_failed", "The connection failed: "+redact(err.Error(), creds)
		if errors.Is(err, connector.ErrCredentials) {
			code, msg = "credentials_refused", "The provider refused the credentials"
		}
		return res, apperr.New(422, code, msg)
	}
	res.Summary = redact(res.Summary, creds)
	return res, nil
}

// StartSync starts a sync inside tx. The caller holds a lock on the source row. When one is active it returns
// *InProgressError. A paused source, a type that is off and maintenance mode start nothing.
func (s *Service) StartSync(ctx context.Context, tx pgx.Tx, src dbgen.DataSource, trigger string, full bool, by uuid.UUID) (dbgen.SourceSync, error) {
	q := dbgen.New(tx)
	if _, err := connectorFor(src.Type); err != nil {
		return dbgen.SourceSync{}, err
	}
	if on, err := platform.SourceTypeEnabled(ctx, q, src.Type); err != nil {
		return dbgen.SourceSync{}, err
	} else if !on {
		return dbgen.SourceSync{}, errTypeOff
	}
	if src.Status == "paused" {
		return dbgen.SourceSync{}, errPaused
	}
	if err := s.Maintenance.Check(ctx); err != nil {
		return dbgen.SourceSync{}, err
	}
	creds, _, err := s.credentials(ctx, q, src.ID)
	if err != nil {
		return dbgen.SourceSync{}, err
	}
	t, _ := sourcetypes.Get(src.Type)
	if err := checkCredentials(t, creds, true); err != nil {
		return dbgen.SourceSync{}, err
	}
	active, err := q.ActiveSourceSync(ctx, src.ID)
	if err == nil {
		return active, &InProgressError{Sync: active}
	} else if !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return dbgen.SourceSync{}, err
	}
	// What an earlier sync held is decided again by this one's listing.
	if err := q.SupersedeHeldRemovals(ctx, src.ID); err != nil {
		return dbgen.SourceSync{}, err
	}
	run, err := q.InsertSourceSync(ctx, dbgen.InsertSourceSyncParams{
		SourceID: src.ID, TeamID: src.TeamID, Trigger: trigger, FullListing: full, CreatedBy: nullUUID(by),
	})
	if err != nil {
		return run, err
	}
	_, err = s.Jobs.InsertTx(ctx, tx, SyncArgs{SyncID: run.ID}, nil)
	return run, err
}

// ListSyncs lists a source's syncs, newest first.
func (s *Service) ListSyncs(ctx context.Context, sourceID uuid.UUID, limit int32) ([]dbgen.SourceSync, error) {
	return s.q.ListSourceSyncs(ctx, dbgen.ListSourceSyncsParams{SourceID: sourceID, PageSize: limit})
}

// CancelSync cancels an active sync inside the caller's transaction. The running job notices at its next item.
func (s *Service) CancelSync(ctx context.Context, q *dbgen.Queries, sourceID, syncID uuid.UUID) (dbgen.SourceSync, error) {
	run, err := q.LockSourceSync(ctx, syncID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && run.SourceID != sourceID) {
		return run, errNoSync
	} else if err != nil {
		return run, err
	}
	if !Active(run) {
		return run, apperr.Conflict("sync_not_active", "This sync has already ended")
	}
	if err := q.ClearSyncRemovals(ctx, run.ID); err != nil {
		return run, err
	}
	observability.ConnectorSyncs.WithLabelValues(typeOf(ctx, q, sourceID), "cancelled").Inc()
	return q.FinishSourceSync(ctx, dbgen.FinishSourceSyncParams{ID: run.ID, Status: StatusCancelled, StoppedReason: "cancelled"})
}

// typeOf is a source's type, for a metric's label ("unknown" when it can't be read).
func typeOf(ctx context.Context, q *dbgen.Queries, sourceID uuid.UUID) string {
	if src, err := q.GetSource(ctx, sourceID); err == nil {
		return src.Type
	}
	return "unknown"
}

// CancelActive cancels a source's active sync, if any (a paused source).
func (s *Service) CancelActive(ctx context.Context, q *dbgen.Queries, sourceID uuid.UUID) error {
	run, err := q.ActiveSourceSync(ctx, sourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	_, err = s.CancelSync(ctx, q, sourceID, run.ID)
	return err
}
