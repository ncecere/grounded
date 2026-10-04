package limits

import (
	"context"
)

// CappedTeam is a team whose own value for a limit is above the ceiling, so
// the ceiling applies to it instead (AD-14).
type CappedTeam struct {
	Slug, Name string
	Override   int64
}

// Capped lists, per limit, the active teams a ceiling caps.
func (s *Service) Capped(ctx context.Context, p Platform) (map[Key][]CappedTeam, error) {
	rows, err := s.q.ListTeamOverrides(ctx)
	if err != nil {
		return nil, err
	}
	out := map[Key][]CappedTeam{}
	for _, r := range rows {
		o, err := parseOverrides(r.Overrides)
		if err != nil {
			continue
		}
		for k, v := range o {
			if c := p.Settings[k].Ceiling; c != nil && v > *c {
				out[k] = append(out[k], CappedTeam{Slug: r.Slug, Name: r.Name, Override: v})
			}
		}
	}
	return out, nil
}
