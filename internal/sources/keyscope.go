package sources

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// An API key restricted to some knowledge bases reaches only the sources those
// use (docs: "A key can also be restricted to some knowledge bases"); outside
// them a source does not exist for the key.

// keyAllows reports whether the acting key may reach a source: any key
// without a knowledge-base restriction, or a source one of its knowledge
// bases uses.
func (s *Service) keyAllows(ctx context.Context, sc scope, sourceID uuid.UUID) (bool, error) {
	if sc.key == nil || len(sc.key.KBIDs) == 0 {
		return true, nil
	}
	return s.q.SourceInKBs(ctx, dbgen.SourceInKBsParams{SourceID: sourceID, KBIDs: sc.key.KBIDs})
}

// keyFilter keeps the sources the acting key may reach (see keyAllows).
func (s *Service) keyFilter(ctx context.Context, sc scope, srcs []dbgen.DataSource) ([]dbgen.DataSource, error) {
	if sc.key == nil || len(sc.key.KBIDs) == 0 {
		return srcs, nil
	}
	out := srcs[:0:0]
	for _, src := range srcs {
		ok, err := s.keyAllows(ctx, sc, src.ID)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, src)
		}
	}
	return out, nil
}
