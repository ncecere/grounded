package contenthealth

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// storeAttempts is how often a store that lost a race with a deletion is repeated before the report is failed.
const storeAttempts = 3

// store keeps the outcome and ends the report. The signals were collected minutes earlier, so a source or document may be gone
// by now; it is never an error that rolls the whole report back and leaves it running:
//
//  1. The report's end is claimed first (a row lock), so a cancel or a delete waits and a cancelled or deleted report ends nothing.
//  2. The platform switch is read under a share lock: a switch turned off before this point stops the store (failed: disabled).
//  3. The sources and documents the snapshot refers to are locked against deletion, and a finding whose source or document no
//     longer exists (or left the scope) is skipped, with the counts adjusted (reconcile): never a foreign-key error.
//  4. Whatever still goes wrong is a real error: the report ends as failed (internal) and the error is returned. It is never
//     reported as success and never left running for the hourly job to find.
func (s *Service) store(ctx context.Context, rep dbgen.ContentHealthReport, out *outcome) error {
	bg := context.WithoutCancel(ctx) // the report is stored even when the job's own time is up: it was made
	var err error
	for range storeAttempts {
		if err = s.storeOnce(bg, rep, out); !isRace(err) {
			break
		}
	}
	switch {
	case err == nil:
		observability.ContentHealthReports.WithLabelValues(StatusCompleted).Inc()
		return nil
	case errors.Is(err, errCancelled):
		return nil
	case errors.Is(err, errDisabled):
		return s.fail(bg, rep.ID, ErrDisabled)
	}
	if st, serr := s.q.ContentHealthReportStatus(bg, rep.ID); errors.Is(serr, pgx.ErrNoRows) || (serr == nil && st != StatusRunning) {
		return nil // deleted or ended meanwhile (with its team, say): there is nothing left to end
	}
	if ferr := s.fail(bg, rep.ID, ErrInternal); ferr != nil {
		s.Log.WarnContext(ctx, "could not record a failed content health report", "report", rep.ID, "err", ferr)
	}
	return err
}

// isRace reports a foreign-key violation, a deadlock or a serialization failure: a concurrent deletion won, and a repeat sees it.
func isRace(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && (pe.Code == "23503" || pe.Code == "40P01" || pe.Code == "40001")
}

func (s *Service) storeOnce(ctx context.Context, rep dbgen.ContentHealthReport, out *outcome) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		if _, err := q.ClaimContentHealthReport(ctx, rep.ID); errors.Is(err, pgx.ErrNoRows) {
			return errCancelled
		} else if err != nil {
			return err
		}
		if st, err := q.GetContentHealthSettingsShare(ctx); err != nil {
			return err
		} else if !st.Enabled {
			return errDisabled
		}
		lv, err := s.lockLive(ctx, q, rep, out)
		if err != nil {
			return err
		}
		if s.afterLock != nil {
			s.afterLock()
		}
		signals, findings, coverage := reconcile(out, lv)
		raw, err := json.Marshal(signals)
		if err != nil {
			return err
		}
		for _, c := range coverage {
			if err := insertCoverage(ctx, q, rep.ID, c); err != nil {
				return err
			}
		}
		for _, sig := range signals {
			if err := insertFindings(ctx, tx, rep.ID, rep.TeamID, sig.Signal, findings[sig.Signal]); err != nil {
				return err
			}
		}
		if n, err := q.FinishContentHealthReport(ctx, dbgen.FinishContentHealthReportParams{ID: rep.ID, Signals: raw, RetentionDays: RetentionDays}); err != nil {
			return err
		} else if n == 0 {
			return errCancelled
		}
		return nil
	})
}

func insertCoverage(ctx context.Context, q *dbgen.Queries, report uuid.UUID, c *Coverage) error {
	var crawl uuid.NullUUID
	if c.LinkCrawlID != uuid.Nil {
		crawl = nullID(c.LinkCrawlID)
	}
	return q.InsertContentHealthSource(ctx, dbgen.InsertContentHealthSourceParams{
		ReportID: report, SourceID: c.SourceID, SourceType: c.Type, Documents: c.Documents, Ready: c.Ready, ReadyNoDate: c.ReadyNoDate,
		ReadyNoHash: c.ReadyNoHash, LinkState: c.LinkState, LinkReason: c.LinkReason, LinkCrawlAt: c.LinkCrawlAt, LinkTruncated: c.LinkTruncated,
		LinkFailed: c.LinkFailed, LinkCrawlID: crawl, SourceRevision: c.SourceRevision, SourceClassification: c.SourceClassification,
		CiteState: c.CiteState, ExposedSince: c.ExposedSince, ExposureAnswers: c.ExposureAnswers,
	})
}

// liveSet is what still exists of what the outcome refers to: its sources, and its documents with the source each is in now.
type liveSet struct {
	sources map[uuid.UUID]bool
	docs    map[uuid.UUID]uuid.UUID
}

// lockLive finds the outcome's sources (still in the scope) and documents that exist now and locks them until the store commits,
// so a deletion cannot slip in between the check and the insert.
func (s *Service) lockLive(ctx context.Context, q *dbgen.Queries, rep dbgen.ContentHealthReport, out *outcome) (liveSet, error) {
	lv := liveSet{sources: map[uuid.UUID]bool{}, docs: map[uuid.UUID]uuid.UUID{}}
	var srcIDs, docIDs []uuid.UUID
	for _, c := range out.coverage {
		srcIDs = append(srcIDs, c.SourceID)
	}
	seen := map[uuid.UUID]bool{}
	for _, fs := range out.findings {
		for _, f := range fs {
			if f.DocumentID != uuid.Nil && !seen[f.DocumentID] {
				seen[f.DocumentID] = true
				docIDs = append(docIDs, f.DocumentID)
			}
		}
	}
	slices.SortFunc(srcIDs, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	slices.SortFunc(docIDs, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	live, err := q.ContentHealthLockScopeSources(ctx, dbgen.ContentHealthLockScopeSourcesParams{
		TeamID: nullID(rep.TeamID), SourceIds: srcIDs, SourceID: rep.ScopeSourceID, KBID: rep.ScopeKbID,
	})
	if err != nil {
		return lv, err
	}
	for _, id := range live {
		lv.sources[id] = true
	}
	docs, err := q.ContentHealthLockDocuments(ctx, dbgen.ContentHealthLockDocumentsParams{TeamID: nullID(rep.TeamID), DocumentIds: docIDs})
	if err != nil {
		return lv, err
	}
	for _, d := range docs {
		lv.docs[d.ID] = d.SourceID
	}
	return lv, nil
}

// reconcile drops what no longer exists: coverage of a source that is gone, and a finding whose source or document is gone (or
// moved to another source). The counts follow: a signal's Found falls by what was dropped (for duplicates, in groups: a group that
// no longer spans two sources is not a duplicate any more), and Counts["vanished"] says how many, so the numbers a team reads
// still add up. Counts such as "judged" describe the moment of collection and are not recomputed.
func reconcile(out *outcome, lv liveSet) ([]storedSignal, map[string][]Finding, []*Coverage) {
	var coverage []*Coverage
	for _, c := range out.coverage {
		if lv.sources[c.SourceID] {
			coverage = append(coverage, c)
		}
	}
	signals := make([]storedSignal, len(out.signals))
	findings := make(map[string][]Finding, len(out.signals))
	for i, sg := range out.signals {
		var kept []Finding
		for _, f := range out.findings[sg.Signal] {
			if lv.sources[f.SourceID] && (f.DocumentID == uuid.Nil || lv.docs[f.DocumentID] == f.SourceID) {
				kept = append(kept, f)
			}
		}
		units := int64(len(kept))
		dropped := int64(len(out.findings[sg.Signal])) - units
		if sg.Signal == SignalDuplicate {
			var before int64
			kept, before, units = keepDuplicateGroups(out.findings[sg.Signal], kept)
			dropped = before - units
		}
		if dropped > 0 {
			counts := make(map[string]int64, len(sg.Counts)+1)
			for k, v := range sg.Counts {
				counts[k] = v
			}
			counts["vanished"] = dropped
			sg.Counts = counts
			sg.Found = max(sg.Found-dropped, 0)
			sg.Truncated = sg.Truncated && sg.Found > units
		}
		signals[i], findings[sg.Signal] = sg, kept
	}
	return signals, findings, coverage
}

// keepDuplicateGroups keeps the groups that still list members of at least two different sources, numbered again from 1. It
// returns the kept members, how many groups the collected list had, and how many remain.
func keepDuplicateGroups(all, live []Finding) (kept []Finding, before, after int64) {
	seen := map[int32]bool{}
	for _, f := range all {
		seen[f.GroupNo] = true
	}
	bySources := map[int32]map[uuid.UUID]bool{}
	for _, f := range live {
		if bySources[f.GroupNo] == nil {
			bySources[f.GroupNo] = map[uuid.UUID]bool{}
		}
		bySources[f.GroupNo][f.SourceID] = true
	}
	renumber := map[int32]int32{}
	for _, f := range live {
		if len(bySources[f.GroupNo]) < 2 {
			continue
		}
		n, ok := renumber[f.GroupNo]
		if !ok {
			n = int32(len(renumber) + 1)
			renumber[f.GroupNo] = n
		}
		f.GroupNo = n
		kept = append(kept, f)
	}
	return kept, int64(len(seen)), int64(len(renumber))
}

// insertFindingsSQL writes a signal's findings from parallel arrays (one round trip). A nil UUID and a zero time mean none.
const insertFindingsSQL = `INSERT INTO content_health_findings (report_id, signal, ord, team_id, source_id, document_id, ref, group_no, group_size, code, detail, value,
                                     observed_at, confirmed_at)
SELECT $1, $2, a.ord, $3, a.source_id, NULLIF(a.document_id, '00000000-0000-0000-0000-000000000000'::uuid), a.ref, a.group_no, a.group_size, a.code, a.detail, a.value,
       NULLIF(a.observed_at, '0001-01-01 00:00:00+00'::timestamptz), NULLIF(a.confirmed_at, '0001-01-01 00:00:00+00'::timestamptz)
FROM unnest($4::int[], $5::uuid[], $6::uuid[], $7::text[], $8::int[], $9::int[], $10::text[], $11::text[], $12::bigint[], $13::timestamptz[], $14::timestamptz[])
     AS a(ord, source_id, document_id, ref, group_no, group_size, code, detail, value, observed_at, confirmed_at)`

func insertFindings(ctx context.Context, tx pgx.Tx, reportID, teamID uuid.UUID, signal string, fs []Finding) error {
	if len(fs) == 0 {
		return nil
	}
	n := len(fs)
	ord, src, doc := make([]int32, n), make([]uuid.UUID, n), make([]uuid.UUID, n)
	ref, code, detail := make([]string, n), make([]string, n), make([]string, n)
	groupNo, groupSize := make([]int32, n), make([]int32, n)
	value := make([]int64, n)
	observed, confirmed := make([]time.Time, n), make([]time.Time, n)
	for i, f := range fs {
		ord[i], src[i], doc[i], ref[i] = int32(i+1), f.SourceID, f.DocumentID, f.Ref
		groupNo[i], groupSize[i], code[i], detail[i], value[i] = f.GroupNo, f.GroupSize, f.Code, f.Detail, f.Value
		observed[i], confirmed[i] = f.ObservedAt, f.ConfirmedAt
	}
	_, err := tx.Exec(ctx, insertFindingsSQL, reportID, signal, teamID, ord, src, doc, ref, groupNo, groupSize, code, detail, value, observed, confirmed)
	return err
}
