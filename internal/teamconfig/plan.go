package teamconfig

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/sources"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/webhooks"
)

// Service plans and applies configuration files (docs/specs/config-as-code-import). Every write goes through the
// domain services' transaction-scoped operations, so a file is held to exactly the checks, limits and audit entries
// the same change made in the app would be.
type Service struct {
	Pool     *pgxpool.Pool
	Sources  *sources.Service
	KBs      *kbs.Service
	Agents   *agents.Service
	Evals    *evals.Service
	Webhooks *webhooks.Service
}

// Plan actions.
const (
	ActionCreate    = "create"
	ActionUpdate    = "update"
	ActionNoOp      = "no-op"
	ActionNotInFile = "not-in-file"
)

// Plan is what applying a file would change, row by row. Nothing is stored: PlanDigest binds an apply to the file and
// the state the plan was computed from, and is never an authorization (§2).
type Plan struct {
	PlanDigest string   `json:"planDigest"`
	Counts     Counts   `json:"counts"`
	Rows       []Row    `json:"rows"`
	Notes      []string `json:"notes"`
}

type Counts struct {
	Create    int `json:"create"`
	Update    int `json:"update"`
	NoOp      int `json:"noOp"`
	NotInFile int `json:"notInFile"`
	Blocked   int `json:"blocked"`
}

// Row is one object: its kind, its identity in the file (name, an agent's slug, a webhook's URL), what applying does,
// the field changes, what stops it and what the editor should know.
type Row struct {
	Kind     string   `json:"kind"`
	Key      string   `json:"key"`
	Action   string   `json:"action"`
	Changes  []Change `json:"changes"`
	Blockers []string `json:"blockers"`
	Notes    []string `json:"notes"`
}

// Change is one field, shown as compact JSON; free text over 200 characters is shown by its length only.
type Change struct {
	Field string `json:"field"`
	From  string `json:"from"`
	To    string `json:"to"`
}

// Plan reads a file and the team in one read-only snapshot and says what applying it would do. It writes nothing,
// starts nothing and records no audit entry, even for a refused file.
func (s *Service) Plan(ctx context.Context, a authz.Actor, teamRef string, body io.Reader) (Plan, error) {
	file, err := decodeFile(body)
	if err != nil {
		return Plan{}, err
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Plan{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := dbgen.New(tx)
	t, err := access(ctx, q, a, teamRef, authz.ScopeConfigurationApply)
	if err != nil {
		return Plan{}, err
	}
	p, _, err := s.compute(ctx, q, a, t, file)
	return p, err
}

// decodeFile is the hostile-input boundary: the bounded YAML reader, then the strict document schema. Errors name a
// structural path and position, never input text.
func decodeFile(body io.Reader) (Document, error) {
	d, err := DecodeDocument(body)
	var syn *SyntaxError
	if errors.As(err, &syn) {
		return d, &apperr.Error{Status: 400, Code: "invalid_configuration",
			Message: "The file is not a valid configuration file (" + syn.Code + " at " + syn.Path + ")",
			Details: map[string]any{"reason": syn.Code, "path": syn.Path, "line": syn.Line, "column": syn.Column}}
	}
	return d, err
}

// digest binds a plan to the team, the file and everything the plan read and concluded: any change to them in between
// gives another digest, and apply refuses (412) with the fresh plan.
func digest(teamID string, file, current Document, skipped map[string]map[string]string, rows []Row) string {
	h := sha256.New()
	for _, part := range []any{"grounded.team/v1 plan", teamID, file, current, skipped, rows} {
		raw, _ := json.Marshal(part)
		h.Write(canonical(raw))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// canonical re-encodes JSON with sorted keys and exact numbers, so equal values compare and hash equal.
func canonical(raw []byte) []byte {
	var v any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if dec.Decode(&v) != nil {
		return raw
	}
	out, _ := json.Marshal(v)
	return out
}

func (p *Plan) count() {
	p.Counts = Counts{}
	for _, r := range p.Rows {
		switch r.Action {
		case ActionCreate:
			p.Counts.Create++
		case ActionUpdate:
			p.Counts.Update++
		case ActionNoOp:
			p.Counts.NoOp++
		case ActionNotInFile:
			p.Counts.NotInFile++
		}
		if len(r.Blockers) > 0 {
			p.Counts.Blocked++
		}
	}
}
