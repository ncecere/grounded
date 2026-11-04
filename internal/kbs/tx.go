package kbs

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/displaytext"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

func (s *Service) prepareCreate(ctx context.Context, a authz.Actor, teamRef string, in Input) (teams.Access, Input, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return acc, in, err
	}
	if err := displaytext.Validate(in.Name, "invalid_name", "Name"); err != nil {
		return acc, in, err
	}
	if in.TopK == 0 {
		in.TopK = 8
	}
	if err := validate(in); err != nil {
		return acc, in, err
	}
	in.Name = strings.TrimSpace(in.Name)
	return acc, in, nil
}

// CreateTx, UpdateTx, AttachSourceTx and DetachSourceTx are Create, Update, AttachSource and DetachSource inside the
// caller's transaction (a configuration file is applied in one, docs/specs/config-as-code-import), with the same checks
// and audit entries.
func (s *Service) CreateTx(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, teamRef string, in Input) (KB, error) {
	acc, in, err := s.prepareCreate(ctx, a, teamRef, in)
	if err != nil {
		return KB{}, err
	}
	var (
		out     dbgen.KnowledgeBase
		created []KB
	)
	if err := s.create(ctx, q, tx, a, acc, in, &out, &created); err != nil {
		return KB{}, err
	}
	return created[0], nil
}

func (s *Service) UpdateTx(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, teamRef string, id uuid.UUID, in Input, expectedRevision int64) (KB, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return KB{}, err
	}
	var out []KB
	if err := s.update(ctx, q, tx, a, acc, id, in, expectedRevision, &out); err != nil {
		return KB{}, err
	}
	return out[0], nil
}

func (s *Service) AttachSourceTx(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, teamRef string, kbID, sourceID uuid.UUID) error {
	return s.changeSourcesTx(ctx, q, tx, a, teamRef, kbID, sourceID, true)
}

func (s *Service) DetachSourceTx(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, teamRef string, kbID, sourceID uuid.UUID) error {
	return s.changeSourcesTx(ctx, q, tx, a, teamRef, kbID, sourceID, false)
}

func (s *Service) changeSourcesTx(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, teamRef string, kbID, sourceID uuid.UUID, attach bool) error {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return err
	}
	var out []KB
	return s.changeSourcesIn(ctx, q, tx, a, acc, kbID, sourceID, attach, &out)
}
