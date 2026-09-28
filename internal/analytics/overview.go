package analytics

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
)

// Overview is the platform analytics of a date range (platform admins and
// auditors). Draft test chats (channel test) are left out of every count
// except the token ledger, which records all usage.
type Overview struct {
	From, To   time.Time // UTC days, inclusive
	Totals     Totals
	Audiences  []Share // answers by audience
	Channels   []Share // answers by channel
	Moderation []ModerationCount
	Models     []ModelTokens
	TopAgents  []TopAgent
	TopTeams   []TopTeam
	Daily      []Day
}

// Totals summarise the range.
type Totals struct {
	Answers, Conversations int64
	// UniqueUsers counts distinct pseudonymous IDs. They are per team (per
	// agent for anonymous sessions), so a person using two teams' agents
	// counts twice; service keys are not counted.
	UniqueUsers     int64
	Up, Down        int64
	Satisfaction    *float64 // up / (up + down); nil without feedback
	NoContextRate   *float64
	RefusalRate     *float64
	ErrorRate       *float64
	LatencyP50Ms    *float64
	LatencyP95Ms    *float64
	FirstTokenP50Ms *float64
	Moderation      ModerationTotals
	Judging         JudgingTotals
	Citations       CitationTotals
	Scope           ScopeTotals
}

// Share is the answers of one audience or channel and their share of all
// answers.
type Share struct {
	Key     string
	Answers int64
	Share   float64
}

// ModelTokens is one model's tokens in the usage ledger.
type ModelTokens struct {
	ModelID                          uuid.UUID
	ModelName                        string // "" when the model was deleted
	Kind                             string // chat, embedding, …; "" when deleted
	ChatInput, ChatOutput, Embedding int64
}

// TopAgent is one of the agents with the most answers.
type TopAgent struct {
	AgentID, TeamID                          uuid.UUID
	AgentSlug, AgentName, TeamSlug, TeamName string // "" when deleted
	Deleted                                  bool
	Answers                                  int64
	NoContextRate                            float64
	Satisfaction                             *float64
	// CitationSupportRate: SystemOne citation checks, verified / checked
	// claim–source pairs; nil when nothing was checked.
	CitationSupportRate *float64
}

// TopTeam is one of the teams with the most answers.
type TopTeam struct {
	TeamID     uuid.UUID
	Slug, Name string // "" when deleted
	Answers    int64
	Agents     int64 // agents with answers in the range
}

// Day is one UTC day of the daily table (and its CSV export).
type Day struct {
	Date                                 time.Time
	Answers, Conversations               int64
	NoContext, Refused, Blocked, Flagged int64
}

// topN bounds the top agents and teams.
const topN = 10

// Filter narrows the platform analytics to one team's agents and to one
// audience (docs/ui-review A9). The zero value is everything.
type Filter struct {
	Team     uuid.NullUUID
	Audience string // "" for every audience
}

// Audiences a Filter may name.
var filterAudiences = map[string]bool{"": true, "team": true, "all_authenticated": true, "public": true}

// liveEvents selects the range's answers outside draft test chats, within
// the filter: $1 and $2 are the range, $3 the team (NULL for all) and $4 the
// audience (empty for all); see Filter.args.
const liveEvents = "created_at >= $1 AND created_at < $2 AND channel <> 'test'" +
	" AND ($3::uuid IS NULL OR team_id = $3) AND ($4::text = '' OR audience_type = $4)"

// args are liveEvents' arguments.
func (f Filter) args(from, end time.Time) []any { return []any{from, end, f.Team, f.Audience} }

// authorize allows platform admins and auditors signed in with a session.
func authorize(a authz.Actor) error {
	if a.Key != nil || !a.CanReadPlatform() {
		return apperr.Forbidden("Only platform admins and auditors can see platform analytics")
	}
	return nil
}

// Overview returns the platform analytics for the UTC days from..to
// (inclusive; zero values default to the last 30 days), within f. Token
// use (Models) isn't recorded per audience, so f.Audience doesn't narrow it.
func (s *Service) Overview(ctx context.Context, a authz.Actor, from, to time.Time, f Filter) (Overview, error) {
	if err := authorize(a); err != nil {
		return Overview{}, err
	}
	from, to, err := Range(from, to)
	if err != nil {
		return Overview{}, err
	}
	if !filterAudiences[f.Audience] {
		return Overview{}, apperr.Invalid("invalid_audience", "Unknown audience")
	}
	end := to.AddDate(0, 0, 1)
	out := Overview{From: from, To: to}
	args := f.args(from, end)
	// The queries scan the same range independently; running them at once
	// keeps a year of events well under the 300 ms target.
	err = parallel(ctx,
		func(ctx context.Context) error { return s.totals(ctx, &out.Totals, args) },
		func(ctx context.Context) error { return s.uniqueUsers(ctx, &out.Totals, args) },
		func(ctx context.Context) error { return s.conversations(ctx, &out.Totals, args) },
		func(ctx context.Context) error { return s.shares(ctx, &out, args) },
		func(ctx context.Context) error { return s.moderation(ctx, &out, args) },
		func(ctx context.Context) (err error) {
			out.Totals.Judging, err = QueryJudging(ctx, s.Pool, liveEvents, args...)
			return err
		},
		func(ctx context.Context) (err error) {
			out.Totals.Citations, err = QueryCitations(ctx, s.Pool, liveEvents, args...)
			return err
		},
		func(ctx context.Context) (err error) {
			out.Totals.Scope, err = QueryScope(ctx, s.Pool, liveEvents, args...)
			return err
		},
		func(ctx context.Context) error { return s.models(ctx, &out, from, end, f.Team) },
		func(ctx context.Context) error { return s.topAgents(ctx, &out, args) },
		func(ctx context.Context) error { return s.topTeams(ctx, &out, args) },
		func(ctx context.Context) (err error) { out.Daily, err = s.daily(ctx, from, end, args); return err },
	)
	if err != nil {
		return Overview{}, err
	}
	return out, nil
}

// Daily returns the daily table for the CSV export, within f.
func (s *Service) Daily(ctx context.Context, a authz.Actor, from, to time.Time, f Filter) (time.Time, time.Time, []Day, error) {
	if err := authorize(a); err != nil {
		return from, to, nil, err
	}
	from, to, err := Range(from, to)
	if err != nil {
		return from, to, nil, err
	}
	if !filterAudiences[f.Audience] {
		return from, to, nil, apperr.Invalid("invalid_audience", "Unknown audience")
	}
	end := to.AddDate(0, 0, 1)
	days, err := s.daily(ctx, from, end, f.args(from, end))
	return from, to, days, err
}

// parallel runs fns concurrently and returns the first error. Each fn
// writes to its own fields.
func parallel(ctx context.Context, fns ...func(context.Context) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var (
		wg    sync.WaitGroup
		once  sync.Once
		first error
	)
	for _, fn := range fns {
		wg.Go(func() {
			if err := fn(ctx); err != nil {
				once.Do(func() { first = err; cancel() })
			}
		})
	}
	wg.Wait()
	return first
}
