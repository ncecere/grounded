package contenthealth

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// day is the unit of every age.
const day = 24 * time.Hour

// StaleCutoff is the latest processing time that counts as stale: a document last processed exactly staleDays before asOf
// is stale ("at least staleDays old"), one second newer is not.
func StaleCutoff(asOf time.Time, staleDays int) time.Time {
	return asOf.Add(-time.Duration(staleDays) * day)
}

// ageDays is the whole days between a time and asOf.
func ageDays(asOf, t time.Time) int64 { return int64(asOf.Sub(t) / day) }

// isEpoch is the "none" the queries return for a time they could not find.
func isEpoch(t time.Time) bool { return t.Unix() <= 0 }

func nullID(id uuid.UUID) uuid.NullUUID { return uuid.NullUUID{UUID: id, Valid: true} }

// staleSignal: ready documents last processed long ago. "Last processed" is when ingestion last finished with the
// document (new or changed content, a retry, a re-parse), not when an author last edited it, which Grounded does not know.
type staleSignal struct{}

func (staleSignal) Name() string { return SignalStale }

func (staleSignal) Collect(ctx context.Context, env *Env) (Result, error) {
	ready, _ := env.readyDocuments()
	if ready == 0 {
		return notApplicable(ReasonNoDocuments), nil
	}
	rows, err := env.Q.ContentHealthStale(ctx, dbgen.ContentHealthStaleParams{
		TeamID: nullID(env.TeamID), SourceIds: env.SourceIDs(), Cutoff: StaleCutoff(env.AsOf, env.Params.StaleDays), PageSize: MaxFindingsPerSignal,
	})
	if err != nil {
		return Result{}, err
	}
	res := Result{State: StateMeasured, Counts: map[string]int64{"ready": ready, "ageUnknown": env.sum(func(c *Coverage) int32 { return c.ReadyNoDate })}}
	for _, r := range rows {
		res.Found = r.Total
		// Old by processing date, yet a crawl saw the page after the cutoff: "recentlyConfirmed" (a flag, not an exclusion).
		res.Counts["recentlyConfirmed"] = r.RecentlyConfirmed
		f := Finding{SourceID: r.SourceID, DocumentID: r.DocumentID, Value: ageDays(env.AsOf, r.ProcessedAt), ObservedAt: r.ProcessedAt}
		if !isEpoch(r.ConfirmedAt) {
			f.ConfirmedAt = r.ConfirmedAt
		}
		res.Findings = append(res.Findings, f)
	}
	res.Truncated = res.Found > int64(len(res.Findings))
	return res, nil
}

// sum totals a per-source count.
func (e *Env) sum(f func(*Coverage) int32) int64 {
	var n int64
	for _, c := range e.Coverage {
		n += int64(f(c))
	}
	return n
}

// duplicateSignal: byte-identical files (the same raw SHA-256) in different sources of the scope. Not near-duplicates, not
// the same text in another format. Never compared across teams, never with a shared source. The hash is not shown.
type duplicateSignal struct{}

func (duplicateSignal) Name() string { return SignalDuplicate }

func (duplicateSignal) Collect(ctx context.Context, env *Env) (Result, error) {
	if len(env.Sources) < 2 {
		return notApplicable(ReasonOneSource), nil
	}
	if ready, _ := env.readyDocuments(); ready == 0 {
		return notApplicable(ReasonNoDocuments), nil
	}
	groups, err := env.Q.ContentHealthDuplicateGroups(ctx, dbgen.ContentHealthDuplicateGroupsParams{
		TeamID: nullID(env.TeamID), SourceIds: env.SourceIDs(), PageSize: MaxDuplicateGroups,
	})
	if err != nil {
		return Result{}, err
	}
	res := Result{State: StateMeasured, Counts: map[string]int64{"withoutHash": env.sum(func(c *Coverage) int32 { return c.ReadyNoHash })}}
	if len(groups) == 0 {
		return res, nil
	}
	res.Found = groups[0].Total
	res.Truncated = res.Found > int64(len(groups))
	hashes := make([]string, len(groups))
	index := make(map[string]int, len(groups))
	for i, g := range groups {
		hashes[i], index[g.Sha256] = g.Sha256, i
	}
	members, err := env.Q.ContentHealthDuplicateMembers(ctx, dbgen.ContentHealthDuplicateMembersParams{
		TeamID: nullID(env.TeamID), SourceIds: env.SourceIDs(), Hashes: hashes, PerGroup: MaxGroupMembers,
	})
	if err != nil {
		return Result{}, err
	}
	// Groups in their order (largest first), each group's documents as the query listed them.
	byGroup := make([][]Finding, len(groups))
	for _, m := range members {
		i := index[m.Sha256]
		byGroup[i] = append(byGroup[i], Finding{
			SourceID: m.SourceID, DocumentID: m.DocumentID, GroupNo: int32(i + 1), GroupSize: int32(groups[i].Members), ObservedAt: m.ProcessedAt,
		})
	}
	for _, fs := range byGroup {
		res.Findings = append(res.Findings, fs...)
	}
	return res, nil
}

// failureSignal: documents that failed, need OCR, or have not finished ingesting. The code is the document's own error
// code and the class is the one Admin → Parsing & OCR uses; the parser's message is never copied.
type failureSignal struct{}

func (failureSignal) Name() string { return SignalIngestionFailure }

func (failureSignal) Collect(ctx context.Context, env *Env) (Result, error) {
	if _, all := env.readyDocuments(); all == 0 {
		return notApplicable(ReasonNoDocuments), nil
	}
	rows, err := env.Q.ContentHealthIngestionFailures(ctx, dbgen.ContentHealthIngestionFailuresParams{
		TeamID: nullID(env.TeamID), SourceIds: env.SourceIDs(), NotFinishedBefore: env.AsOf.Add(-NotFinishedAfter), AsOf: env.AsOf,
		PageSize: MaxFindingsPerSignal,
	})
	if err != nil {
		return Result{}, err
	}
	res := Result{State: StateMeasured}
	for _, r := range rows {
		res.Found = r.Total
		res.Findings = append(res.Findings, Finding{SourceID: r.SourceID, DocumentID: r.DocumentID, Code: r.Class, Detail: r.ErrorCode, ObservedAt: r.UpdatedAt})
	}
	res.Truncated = res.Found > int64(len(res.Findings))
	return res, nil
}
