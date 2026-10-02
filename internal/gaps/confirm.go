// "Confirm similar questions with SystemOne" (owner decision 4 of
// 2026-10-01): a team's setting, off by default, under which the topics
// job asks SystemOne whether a borderline pair of questions is about the
// same subject. The checks are metered to the team (usage source "gaps"),
// skipped while its budget is used up, and bounded per run.

package gaps

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
)

// confirmsPerRun bounds the SystemOne checks of a run.
const confirmsPerRun = 200

// confirmer asks SystemOne for one run of the job.
type confirmer struct {
	r      *Runner
	loaded bool
	client *systemone.Client
	teams  map[uuid.UUID]bool
	asks   int
	// Asked counts the checks that were answered.
	Asked int
}

func (r *Runner) confirmer() *confirmer { return &confirmer{r: r, teams: map[uuid.UUID]bool{}} }

// available reports whether the platform has a usable SystemOne model.
func (cf *confirmer) available(ctx context.Context) bool {
	if !cf.loaded {
		cf.loaded = true
		if cf.r.SystemOne != nil {
			cl, err := cf.r.SystemOne(ctx)
			if err != nil {
				cf.r.log().WarnContext(ctx, "gap topics: SystemOne isn't available; borderline questions aren't confirmed this run", "err", err)
			}
			cf.client = cl
		}
	}
	return cf.client != nil
}

// enabled reports whether the team turned the confirmation on.
func (cf *confirmer) enabled(ctx context.Context, teamID uuid.UUID) bool {
	on, ok := cf.teams[teamID]
	if !ok {
		err := cf.r.Pool.QueryRow(ctx, `SELECT confirm_similar FROM gap_settings WHERE team_id = $1`, teamID).Scan(&on)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			cf.r.log().WarnContext(ctx, "gap topics: could not read a team's settings", "team", teamID, "err", err)
		}
		cf.teams[teamID] = on
	}
	return on
}

// same reports whether SystemOne confirms a borderline question pair for a
// team that turned the confirmation on (false otherwise).
func (cf *confirmer) same(ctx context.Context, teamID, agentID uuid.UUID, a, b string) bool {
	if !cf.enabled(ctx, teamID) {
		return false
	}
	same, _ := cf.ask(ctx, teamID, agentID, a, b)
	return same
}

// ask asks SystemOne and meters the check to the team. asked is false when
// it couldn't (no model, the run's limit, the team's budget, an error).
func (cf *confirmer) ask(ctx context.Context, teamID, agentID uuid.UUID, a, b string) (same, asked bool) {
	if a == "" || b == "" || cf.asks >= confirmsPerRun || !cf.available(ctx) {
		return false, false
	}
	if cf.r.Budget != nil && cf.r.Budget(ctx, teamID) != nil {
		return false, false
	}
	cf.asks++
	m := &systemone.Meter{}
	same, err := cf.client.SameSubject(systemone.WithMeter(ctx, m), a, b)
	if err := cf.meter(ctx, m, teamID, agentID); err != nil {
		cf.r.log().WarnContext(ctx, "gap topics: could not meter a SystemOne check", "team", teamID, "err", err)
	}
	if err != nil {
		cf.r.log().WarnContext(ctx, "gap topics: SystemOne check failed; the pair stays apart this run", "agent", agentID, "err", err)
		return false, false
	}
	cf.Asked++
	return same, true
}

// meter records a check's SystemOne usage for the team and agent.
func (cf *confirmer) meter(ctx context.Context, m *systemone.Meter, teamID, agentID uuid.UUID) error {
	q := dbgen.New(cf.r.Pool)
	for _, e := range m.Entries() {
		meta, _ := json.Marshal(map[string]any{"source": "gaps", "feature": e.Feature})
		for _, u := range e.UsageParams(meta) {
			u.TeamID, u.AgentID = uuid.NullUUID{UUID: teamID, Valid: true}, uuid.NullUUID{UUID: agentID, Valid: true}
			if err := q.InsertUsage(ctx, u); err != nil {
				return err
			}
		}
	}
	return nil
}
