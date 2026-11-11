package sources

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/sourcesync"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Stats summarises a source's documents.
type Stats struct {
	ByStatus map[string]int64
	Bytes    int64
	Chunks   int64
	// PIIReview counts the documents waiting for a review of possible personal data.
	PIIReview int64
}

// Summary is a source with its document statistics and active crawl.
type Summary struct {
	Source      dbgen.DataSource
	Stats       Stats
	ActiveCrawl *dbgen.WebCrawl
	// Connector is a connector source's schedule, stored credential fields and held removals, and ActiveSync its
	// queued or running sync (nil for upload and web sources).
	Connector   *sourcesync.State
	ActiveSync  *dbgen.SourceSync
	Boilerplate BoilerplateSummary
}

func (s *Service) summaries(ctx context.Context, srcs []dbgen.DataSource, withCrawls bool) ([]Summary, error) {
	ids := make([]uuid.UUID, len(srcs))
	for i, src := range srcs {
		ids[i] = src.ID
	}
	rows, err := s.q.SourceDocumentStats(ctx, ids)
	if err != nil {
		return nil, err
	}
	stats := map[uuid.UUID]Stats{}
	for _, r := range rows {
		st := stats[r.SourceID]
		if st.ByStatus == nil {
			st.ByStatus = map[string]int64{}
		}
		st.ByStatus[r.Status] = r.Documents
		st.Bytes += r.Bytes
		st.Chunks += r.Chunks
		st.PIIReview += r.PiiReview
		stats[r.SourceID] = st
	}
	active := map[uuid.UUID]dbgen.WebCrawl{}
	if withCrawls {
		if active, err = s.Web.ActiveRuns(ctx, ids); err != nil {
			return nil, err
		}
	}
	bp, err := s.boilerplateSummaries(ctx, srcs, ids)
	if err != nil {
		return nil, err
	}
	states := map[uuid.UUID]sourcesync.State{}
	if s.Connectors != nil && withCrawls {
		if states, err = s.Connectors.States(ctx, srcs); err != nil {
			return nil, err
		}
	}
	out := make([]Summary, len(srcs))
	for i, src := range srcs {
		out[i] = Summary{Source: src, Stats: stats[src.ID], Boilerplate: bp[src.ID]}
		if c, ok := active[src.ID]; ok {
			out[i].ActiveCrawl = &c
		}
		if st, ok := states[src.ID]; ok {
			out[i].Connector, out[i].ActiveSync = &st, st.Active
		}
	}
	return out, nil
}

func (s *Service) summary(ctx context.Context, src dbgen.DataSource) (Summary, error) {
	out, err := s.summaries(ctx, []dbgen.DataSource{src}, true)
	if err != nil {
		return Summary{}, err
	}
	return out[0], nil
}

func (s *Service) List(ctx context.Context, a authz.Actor, o Owner) ([]Summary, error) {
	sc, err := s.readAccess(ctx, a, o, breakglass.Read{Kind: breakglass.ReadSourceList})
	if err != nil {
		return nil, err
	}
	var srcs []dbgen.DataSource
	if sc.team == nil {
		srcs, err = s.q.ListPlatformSources(ctx)
	} else {
		srcs, err = s.q.ListTeamSources(ctx, sc.teamID())
	}
	if err != nil {
		return nil, err
	}
	if srcs, err = s.keyFilter(ctx, sc, srcs); err != nil {
		return nil, err
	}
	return s.summaries(ctx, srcs, true)
}

// ListShared is the catalog of platform-shared sources that signed-in users
// see when attaching sources to knowledge bases: metadata and document
// counts only, never documents.
func (s *Service) ListShared(ctx context.Context, a authz.Actor) ([]Summary, error) {
	if a.Key != nil || a.UserID == uuid.Nil {
		return nil, apperr.Forbidden("Sign in to see shared sources")
	}
	srcs, err := s.q.ListPlatformSources(ctx)
	if err != nil {
		return nil, err
	}
	return s.summaries(ctx, srcs, false)
}

func (s *Service) Get(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID) (Summary, error) {
	sc, err := s.readAccess(ctx, a, o, sourceRead(breakglass.ReadSource, id))
	if err != nil {
		return Summary{}, err
	}
	src, err := s.source(ctx, s.q, sc, id, false)
	if err != nil {
		return Summary{}, err
	}
	return s.summary(ctx, src)
}
