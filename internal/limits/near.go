package limits

import (
	"context"
	"sort"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
)

// NearLimit is a team resource at or above the warning share of its
// effective limit (the admin Overview's attention queue).
type NearLimit struct {
	TeamSlug, TeamName string
	Def                Def
	Used, Max          int64
}

// NearWarning is the share of a limit at which it is reported (80%).
const NearWarning = 0.8

// TeamsNearLimits lists the resource caps (storage, documents, sources,
// knowledge bases, agents) of active teams used at NearWarning or more,
// fullest first (platform admins and auditors).
func (s *Service) TeamsNearLimits(ctx context.Context, a authz.Actor) ([]NearLimit, error) {
	if !a.CanReadPlatform() {
		return nil, apperr.Forbidden("Only platform admins and auditors can read every team's usage")
	}
	rows, err := s.q.ActiveTeamResourceUsage(ctx)
	if err != nil {
		return nil, err
	}
	out := []NearLimit{}
	for _, t := range rows {
		set, err := s.Effective(ctx, s.q, t.ID)
		if err != nil {
			return nil, err
		}
		used := map[Key]int64{StorageBytes: t.StorageBytes, Documents: t.Documents, DataSources: t.DataSources, KnowledgeBases: t.KnowledgeBases, Agents: t.Agents}
		for _, k := range []Key{StorageBytes, Documents, DataSources, KnowledgeBases, Agents} {
			max := set.Get(k)
			if max == nil || *max <= 0 || float64(used[k]) < NearWarning*float64(*max) {
				continue
			}
			d, _ := Lookup(k)
			out = append(out, NearLimit{TeamSlug: t.Slug, TeamName: t.Name, Def: d, Used: used[k], Max: *max})
		}
	}
	sortNear(out)
	return out, nil
}

func sortNear(list []NearLimit) {
	share := func(n NearLimit) float64 { return float64(n.Used) / float64(n.Max) }
	sort.SliceStable(list, func(i, j int) bool { return share(list[i]) > share(list[j]) })
}
