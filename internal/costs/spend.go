package costs

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Spend: priced usage over a range of instants. Quantities are summed in
// SQL per local day, unit and model (plus the report's grouping); prices are
// applied here, exactly, per local day.

// Categories of spend, in display order.
var Categories = []string{"chat", "embedding", "systemone", "moderation"}

// Totals are spend and quantities.
type Totals struct {
	Spend      *big.Rat
	ByCategory map[string]*big.Rat
	Tokens     int64 // chat, embedding and SystemOne tokens
	Requests   int64 // SystemOne and moderation requests
	// Unpriced: some usage had no price (it counts as zero).
	Unpriced bool
}

// NewTotals returns zero totals.
func NewTotals() *Totals {
	t := &Totals{Spend: new(big.Rat), ByCategory: map[string]*big.Rat{}}
	for _, c := range Categories {
		t.ByCategory[c] = new(big.Rat)
	}
	return t
}

func (t *Totals) add(unit string, qty int64, cost *big.Rat) {
	if PerUnits(unit) == 1 {
		t.Requests += qty
	} else {
		t.Tokens += qty
	}
	if cost == nil {
		t.Unpriced = t.Unpriced || qty > 0
		return
	}
	t.Spend.Add(t.Spend, cost)
	c := t.ByCategory[Category(unit)]
	c.Add(c, cost)
}

func (t *Totals) merge(o *Totals) {
	t.Spend.Add(t.Spend, o.Spend)
	for _, c := range Categories {
		t.ByCategory[c].Add(t.ByCategory[c], o.ByCategory[c])
	}
	t.Tokens, t.Requests, t.Unpriced = t.Tokens+o.Tokens, t.Requests+o.Requests, t.Unpriced || o.Unpriced
}

// usageRow is one aggregated quantity.
type usageRow struct {
	Day      Day
	Unit     string
	Model    uuid.NullUUID
	Team     uuid.NullUUID
	Agent    uuid.NullUUID
	Quantity int64
}

// Groupings of the usage query: which of team and agent it keeps.
const (
	groupNone  = ""
	groupTeam  = "team"
	groupAgent = "agent"
)

var groupCols = map[string]string{groupNone: "NULL::uuid, NULL::uuid", groupTeam: "team_id, NULL::uuid", groupAgent: "team_id, agent_id"}

// usageSQL sums priced usage in the hour buckets [$1, $2): the rollup, plus
// the events of hours not rolled up yet (read in the same statement as the
// watermark). $3: the kinds, $4: one team (NULL: all), $5: the time zone.
const usageSQL = `
WITH st AS (SELECT coalesce(rolled_until, '-infinity'::timestamptz) AS ru FROM usage_rollup_state WHERE singleton),
u AS (
    SELECT r.hour, r.kind, r.model_id, r.team_id, r.agent_id, r.quantity FROM usage_rollup r
    WHERE r.hour >= $1 AND r.hour < $2 AND r.kind = ANY($3::text[]) AND ($4::uuid IS NULL OR r.team_id = $4::uuid)
    UNION ALL
    SELECT date_trunc('hour', e.occurred_at, 'UTC'), e.kind, e.model_id, e.team_id, e.agent_id, e.quantity
    FROM usage_events e, st
    WHERE e.occurred_at >= greatest($1, st.ru) AND e.occurred_at < $2 AND e.kind = ANY($3::text[])
      AND ($4::uuid IS NULL OR e.team_id = $4::uuid)
)
SELECT (hour AT TIME ZONE $5::text)::date, kind, model_id, %s, sum(quantity)::bigint
FROM u GROUP BY 1, 2, 3, 4, 5`

// usage aggregates priced usage whose hour starts in [from, to).
func (s *Service) usage(ctx context.Context, from, to time.Time, tz, group string, team uuid.NullUUID) ([]usageRow, error) {
	lo, hi := HourRange(from, to)
	rows, err := s.pool.Query(ctx, fmt.Sprintf(usageSQL, groupCols[group]), lo, hi, PricedUnits, team, tz)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (usageRow, error) {
		var u usageRow
		var day time.Time
		err := r.Scan(&day, &u.Unit, &u.Model, &u.Team, &u.Agent, &u.Quantity)
		u.Day = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
		return u, err
	})
}

// priceRow is a usage row's cost (nil: unpriced).
func priceRow(book PriceBook, u usageRow) *big.Rat {
	if !u.Model.Valid {
		return nil
	}
	p, ok := book.At(u.Model.UUID, u.Unit, u.Day)
	if !ok {
		return nil
	}
	return Cost(u.Quantity, u.Unit, p.Price)
}

// Sum prices usage rows into totals per key.
func Sum[K comparable](book PriceBook, rows []usageRow, key func(usageRow) K) map[K]*Totals {
	out := map[K]*Totals{}
	for _, u := range rows {
		k := key(u)
		t := out[k]
		if t == nil {
			t = NewTotals()
			out[k] = t
		}
		t.add(u.Unit, u.Quantity, priceRow(book, u))
	}
	return out
}

// teamSpend is teams' priced usage in [from, to) (team: one team, or all).
func (s *Service) teamSpend(ctx context.Context, st Settings, from, to time.Time, team uuid.NullUUID) (map[uuid.UUID]*Totals, error) {
	book, err := s.priceBook(ctx, st.Generation)
	if err != nil {
		return nil, err
	}
	rows, err := s.usage(ctx, from, to, st.TimeZone, groupTeam, team)
	if err != nil {
		return nil, err
	}
	return Sum(book, rows, func(u usageRow) uuid.UUID { return u.Team.UUID }), nil
}

// Projected is the month-end spend at the month-to-date rate (nil before
// the month has run for an hour).
func Projected(spent *big.Rat, start, end, now time.Time) *big.Rat {
	elapsed := now.Sub(start)
	if elapsed < time.Hour || !now.Before(end) {
		if !now.Before(end) {
			return new(big.Rat).Set(spent)
		}
		return nil
	}
	p := new(big.Rat).Mul(spent, big.NewRat(int64(end.Sub(start)/time.Second), 1))
	return p.Quo(p, big.NewRat(int64(elapsed/time.Second), 1))
}
