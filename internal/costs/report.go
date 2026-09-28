package costs

import (
	"context"
	"encoding/csv"
	"io"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
)

// Reports: spend over a range of local days, grouped by team, agent, model
// or day (Admin → Costs, and a team's own spend in Team settings → Usage).

// Report groupings.
const (
	ByTeam  = "team"
	ByAgent = "agent"
	ByModel = "model"
	ByDay   = "day"
)

// MaxReportDays bounds a report's range.
const MaxReportDays = 366

// ReportRow is one group's spend.
type ReportRow struct {
	Key    string // the team, agent or model ID, or the date ("" : none, such as usage without an agent)
	Label  string
	TeamID uuid.NullUUID
	// TeamSlug and TeamName: the team (rows by team and by agent).
	TeamSlug, TeamName string
	ModelKind          string // rows by model
	Deleted            bool   // the agent or model no longer exists
	*Totals
}

// Report is spend over [From, To] (local days, inclusive).
type Report struct {
	From, To Day
	GroupBy  string
	Currency string
	TimeZone string
	Total    *Totals
	Rows     []ReportRow
}

// ReportFilter narrows a report.
type ReportFilter struct {
	From, To Day
	GroupBy  string
	Team     uuid.NullUUID // one team's usage only
}

func checkRange(f ReportFilter) error {
	switch f.GroupBy {
	case ByTeam, ByAgent, ByModel, ByDay:
	default:
		return apperr.Invalid("invalid_group", "groupBy must be team, agent, model or day")
	}
	if f.To.Before(f.From) {
		return apperr.Invalid("invalid_range", "The range must end on or after its first day.")
	}
	if f.To.Sub(f.From) >= MaxReportDays*24*time.Hour {
		return apperr.Invalid("invalid_range", "A report covers at most 366 days.")
	}
	return nil
}

// Report returns platform spend (platform admins and auditors).
func (s *Service) Report(ctx context.Context, a authz.Actor, f ReportFilter) (Report, error) {
	if !canRead(a) {
		return Report{}, errReadOnly
	}
	return s.report(ctx, f)
}

func (s *Service) report(ctx context.Context, f ReportFilter) (Report, error) {
	if err := checkRange(f); err != nil {
		return Report{}, err
	}
	st, err := s.current(ctx)
	if err != nil {
		return Report{}, err
	}
	loc := st.Location()
	book, err := s.priceBook(ctx, st.Generation)
	if err != nil {
		return Report{}, err
	}
	group := map[string]string{ByTeam: groupTeam, ByAgent: groupAgent}[f.GroupBy]
	rows, err := s.usage(ctx, StartOf(f.From, loc), StartOf(f.To.AddDate(0, 0, 1), loc), st.TimeZone, group, f.Team)
	if err != nil {
		return Report{}, err
	}
	out := Report{From: f.From, To: f.To, GroupBy: f.GroupBy, Currency: st.Currency, TimeZone: st.TimeZone, Total: NewTotals()}
	byKey := Sum(book, rows, func(u usageRow) string { return rowKey(f.GroupBy, u) })
	teamOf := map[string]uuid.NullUUID{}
	for _, u := range rows {
		teamOf[rowKey(f.GroupBy, u)] = u.Team
	}
	if f.GroupBy == ByDay {
		for d := f.From; !d.After(f.To); d = d.AddDate(0, 0, 1) {
			if _, ok := byKey[d.Format(time.DateOnly)]; !ok {
				byKey[d.Format(time.DateOnly)] = NewTotals()
			}
		}
	}
	for k, t := range byKey {
		out.Total.merge(t)
		out.Rows = append(out.Rows, ReportRow{Key: k, Label: k, TeamID: teamOf[k], Totals: t})
	}
	if err := s.label(ctx, f.GroupBy, out.Rows); err != nil {
		return Report{}, err
	}
	sortRows(f.GroupBy, out.Rows)
	return out, nil
}

func rowKey(groupBy string, u usageRow) string {
	id := func(n uuid.NullUUID) string {
		if n.Valid {
			return n.UUID.String()
		}
		return ""
	}
	switch groupBy {
	case ByTeam:
		return id(u.Team)
	case ByAgent:
		return id(u.Agent)
	case ByModel:
		return id(u.Model)
	}
	return u.Day.Format(time.DateOnly)
}

func sortRows(groupBy string, rows []ReportRow) {
	sort.SliceStable(rows, func(i, j int) bool {
		if groupBy == ByDay {
			return rows[i].Key < rows[j].Key
		}
		if c := rows[i].Spend.Cmp(rows[j].Spend); c != 0 {
			return c > 0
		}
		if rows[i].Tokens+rows[i].Requests != rows[j].Tokens+rows[j].Requests {
			return rows[i].Tokens+rows[i].Requests > rows[j].Tokens+rows[j].Requests
		}
		return rows[i].Label < rows[j].Label
	})
}

// Names of rows without a key.
const (
	labelNoTeam  = "Shared sources (no team)"
	labelNoAgent = "Not from an agent (search, ingestion)"
	labelNoModel = "Unknown model"
)

// label fills in the names of teams, agents and models (as they are now).
func (s *Service) label(ctx context.Context, groupBy string, rows []ReportRow) error {
	teams, err := s.names(ctx, `SELECT id, slug, name, '', false FROM teams WHERE id = ANY($1)`, rows, func(r ReportRow) uuid.NullUUID { return r.TeamID })
	if err != nil {
		return err
	}
	var own map[uuid.UUID]name
	switch groupBy {
	case ByAgent:
		own, err = s.names(ctx, `SELECT id, slug, name, '', deleted_at IS NOT NULL FROM agents WHERE id = ANY($1)`, rows, keyID)
	case ByModel:
		own, err = s.names(ctx, `SELECT id, key, display_name, kind, false FROM models WHERE id = ANY($1)`, rows, keyID)
	}
	if err != nil {
		return err
	}
	fallback := map[string]string{ByTeam: labelNoTeam, ByAgent: labelNoAgent, ByModel: labelNoModel}[groupBy]
	for i := range rows {
		r := &rows[i]
		if t, ok := teams[r.TeamID.UUID]; ok && r.TeamID.Valid {
			r.TeamSlug, r.TeamName = t.slug, t.name
		}
		switch {
		case groupBy == ByDay:
		case groupBy == ByTeam && r.TeamName != "":
			r.Label = r.TeamName
		case own[keyID(*r).UUID].name != "" && keyID(*r).Valid:
			n := own[keyID(*r).UUID]
			r.Label, r.ModelKind, r.Deleted = n.name, n.kind, n.deleted
		case r.Key == "":
			r.Label = fallback
		default:
			r.Deleted = true
		}
	}
	return nil
}

func keyID(r ReportRow) uuid.NullUUID {
	id, err := uuid.Parse(r.Key)
	return uuid.NullUUID{UUID: id, Valid: err == nil}
}

type name struct {
	slug, name, kind string
	deleted          bool
}

func (s *Service) names(ctx context.Context, query string, rows []ReportRow, id func(ReportRow) uuid.NullUUID) (map[uuid.UUID]name, error) {
	var ids []uuid.UUID
	for _, r := range rows {
		if n := id(r); n.Valid {
			ids = append(ids, n.UUID)
		}
	}
	out := map[uuid.UUID]name{}
	if len(ids) == 0 {
		return out, nil
	}
	res, err := s.pool.Query(ctx, query, ids)
	if err != nil {
		return nil, err
	}
	defer res.Close()
	for res.Next() {
		var k uuid.UUID
		var n name
		if err := res.Scan(&k, &n.slug, &n.name, &n.kind, &n.deleted); err != nil {
			return nil, err
		}
		out[k] = n
	}
	return out, res.Err()
}

// csvColumns are the columns naming a report's row, which depend on the
// grouping: every name is unique, and a day has no empty name or team.
func csvColumns(groupBy string) ([]string, func(ReportRow) []string) {
	switch groupBy {
	case ByTeam:
		return []string{"team_id", "team_slug", "team_name"}, func(r ReportRow) []string { return []string{r.Key, r.TeamSlug, r.Label} }
	case ByAgent:
		return []string{"agent_id", "agent_name", "team_slug", "team_name"}, func(r ReportRow) []string { return []string{r.Key, r.Label, r.TeamSlug, r.TeamName} }
	case ByModel:
		return []string{"model_id", "model_name", "model_kind"}, func(r ReportRow) []string { return []string{r.Key, r.Label, r.ModelKind} }
	}
	return []string{"day"}, func(r ReportRow) []string { return []string{r.Key} }
}

// WriteCSV writes a report as CSV: one row per group, amounts as decimal
// strings. The first columns name the row (csvColumns); the rest are the
// same for every grouping.
func WriteCSV(w io.Writer, r Report) error {
	cw := csv.NewWriter(w)
	head, naming := csvColumns(r.GroupBy)
	head = append(head, "currency", "spend")
	head = append(head, Categories...)
	head = append(head, "tokens", "requests", "unpriced")
	if err := cw.Write(head); err != nil {
		return err
	}
	for _, row := range r.Rows {
		rec := append(naming(row), r.Currency, Format(row.Spend))
		for _, c := range Categories {
			rec = append(rec, Format(row.ByCategory[c]))
		}
		rec = append(rec, strconv.FormatInt(row.Tokens, 10), strconv.FormatInt(row.Requests, 10), strconv.FormatBool(row.Unpriced))
		if err := cw.Write(rec); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// ---- a team's own view --------------------------------------------------------------

var errCostsOff = apperr.NotFound("costs_off", "Cost tracking is off for this team")

// TeamSpend is a team's spend: this month against its budget, and a range
// by agent and model.
type TeamSpend struct {
	Status   Status
	TimeZone string
	Total    *Totals
	From, To Day
	Agents   []ReportRow
	Models   []ReportRow
}

// TeamSpend returns a team's spend (its owners and admins, platform admins
// and auditors). It is 404 costs_off while the team's mode is off. from and
// to default to this month so far.
func (s *Service) TeamSpend(ctx context.Context, a authz.Actor, teamRef string, from, to *Day) (TeamSpend, error) {
	acc, err := s.teams.Get(ctx, a, teamRef)
	if err != nil {
		return TeamSpend{}, err
	}
	if a.Key != nil || (!authz.RoleAtLeast(acc.Role, authz.RoleAdmin) && !a.CanReadPlatform()) {
		return TeamSpend{}, apperr.Forbidden("Only the team's owners and admins can see its spend")
	}
	st, err := s.status(ctx, acc.Team.ID, false)
	if err != nil {
		return TeamSpend{}, err
	}
	if st.Mode == ModeOff {
		return TeamSpend{}, errCostsOff
	}
	f := ReportFilter{From: st.Month, To: DayOf(s.now(), st.Location), Team: uuid.NullUUID{UUID: acc.Team.ID, Valid: true}}
	if from != nil {
		f.From = *from
	}
	if to != nil {
		f.To = *to
	}
	out := TeamSpend{Status: st, TimeZone: st.Location.String(), From: f.From, To: f.To}
	for _, g := range []string{ByAgent, ByModel} {
		f.GroupBy = g
		r, err := s.report(ctx, f)
		if err != nil {
			return TeamSpend{}, err
		}
		out.Total = r.Total
		if g == ByAgent {
			out.Agents = r.Rows
		} else {
			out.Models = r.Rows
		}
	}
	return out, nil
}

// BudgetStatus is what every member of a team sees about its budget: the
// state, and the amounts only for its owners and admins (and platform
// readers).
type BudgetStatus struct {
	Status      Status
	ShowAmounts bool
}

// TeamBudgetStatus returns a team's budget state for its workspace banner
// (members, platform admins and auditors). Teams that aren't enforced are
// StateNone.
func (s *Service) TeamBudgetStatus(ctx context.Context, a authz.Actor, teamRef string) (BudgetStatus, error) {
	acc, err := s.teams.Get(ctx, a, teamRef)
	if err != nil {
		return BudgetStatus{}, err
	}
	st, err := s.status(ctx, acc.Team.ID, false)
	if err != nil {
		return BudgetStatus{}, err
	}
	show := a.Key == nil && (authz.RoleAtLeast(acc.Role, authz.RoleAdmin) || a.CanReadPlatform())
	return BudgetStatus{Status: st, ShowAmounts: show}, nil
}
