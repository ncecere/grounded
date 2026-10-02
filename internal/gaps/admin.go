// Counts for platform admins and auditors: failed questions per team and
// signal, never topics or questions (docs/v0.4.0.md §2, owner decision 2).

package gaps

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// TeamCounts is one team's failed questions in a period.
type TeamCounts struct {
	TeamID     uuid.UUID
	Slug, Name string
	Questions  int32
	Signals    map[string]int32
}

// Counts returns failed questions per team in [from, to), most first,
// optionally of answers to one audience ("": all; platform admins and
// auditors).
func (s *Service) Counts(ctx context.Context, a authz.Actor, from, to time.Time, audience string) ([]TeamCounts, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return nil, apperr.Forbidden("Only platform admins and auditors can see this")
	}
	var aud *string
	if audience != "" {
		aud = &audience
	}
	totals, err := s.q.GapTotalsByTeam(ctx, dbgen.GapTotalsByTeamParams{FromAt: from, ToAt: to, Audience: aud})
	if err != nil {
		return nil, err
	}
	out := make([]TeamCounts, len(totals))
	byTeam := map[uuid.UUID]*TeamCounts{}
	for i, t := range totals {
		out[i] = TeamCounts{TeamID: t.TeamID, Slug: t.Slug, Name: t.Name, Questions: t.Questions, Signals: map[string]int32{}}
		byTeam[t.TeamID] = &out[i]
	}
	rows, err := s.q.GapCountsByTeam(ctx, dbgen.GapCountsByTeamParams{FromAt: from, ToAt: to, Audience: aud})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if t := byTeam[r.TeamID]; t != nil {
			t.Signals[r.Signal] = r.N
		}
	}
	return out, nil
}
