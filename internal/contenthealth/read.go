package contenthealth

import (
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Reading a report reads stored rows, one page at a time. It never collects a signal, never calls out, and authorizes again
// on every call (role, team status, the platform switch, and the report's team).

// Report is a report as the team sees it.
type Report struct {
	ID                 uuid.UUID
	Status             string
	SourceID           *uuid.UUID
	KBID               *uuid.UUID
	StaleDays          int
	CitationWindowDays int
	AsOf               *time.Time
	CreatedAt          time.Time
	StartedAt          *time.Time
	FinishedAt         *time.Time
	ExpiresAt          *time.Time
	ErrorCode          string
	Signals            []SignalView
}

// SignalView is one signal's result. Found is the count when the report was made; Listed is what still holds now, in the same
// unit (for duplicates, groups that still span two sources of the report). Findings follow deletions, scope and source changes,
// so Listed can be lower; it is never higher than what was stored.
type SignalView struct {
	Signal        string
	State         string
	Reason        string
	Found         int64
	Listed        int64
	Truncated     bool
	Counts        map[string]int64
	ObservedSince *time.Time
}

// SourceCoverage is what the report knew about one source.
type SourceCoverage struct {
	SourceID      uuid.UUID
	Name          string
	Type          string
	Documents     int32
	Ready         int32
	ReadyNoDate   int32
	ReadyNoHash   int32
	LinkState     string
	LinkReason    string
	LinkCrawlAt   *time.Time
	LinkTruncated bool
	LinkFailed    int32
	// LinkRefs says whether this source's failed addresses are still shown: current, source_changed (its revision or
	// classification changed since the crawl was read), crawl_changed (a newer completed crawl exists) or none.
	LinkRefs string
	// CiteState, ExposedSince and ExposureAnswers: what the not-cited signal could say about the source.
	CiteState       string
	ExposedSince    *time.Time
	ExposureAnswers int32
}

// Detail is a report with its per-source coverage.
type Detail struct {
	Report  Report
	Sources []SourceCoverage
}

// FindingView is a finding with the live names of its source and document.
type FindingView struct {
	Signal       string
	Ord          int32
	SourceID     uuid.UUID
	SourceName   string
	SourceType   string
	DocumentID   *uuid.UUID
	Title        string
	Filename     string
	URL          string
	Kind         string
	Ref          string
	GroupNo      int32
	GroupSize    int32
	Code         string
	Detail       string
	Value        int64
	ObservedAt   *time.Time
	ConfirmedAt  *time.Time
	ChangedSince bool
}

// FindingsPage is a page of one signal's findings; After is the cursor for the next page (0: none).
type FindingsPage struct {
	Items []FindingView
	After int32
}

// List is a team's reports, newest first, and whether the platform switch is on. While it is off the reports are listed as
// metadata only (stubs: no signal, count or finding), so a team can still stop or delete what is kept.
type List struct {
	Enabled bool
	Reports []Report
}

// List returns the team's reports (editors, admins and owners). While the switch is off it returns stubs: when and what kind of
// report is kept, so it can be cancelled or deleted, and nothing the report found.
func (s *Service) List(ctx context.Context, a authz.Actor, teamRef string) (List, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return List{}, err
	}
	on, err := s.enabled(ctx)
	if err != nil {
		return List{}, err
	}
	rows, err := s.q.ListContentHealthReports(ctx, dbgen.ListContentHealthReportsParams{TeamID: acc.Team.ID, PageSize: KeepReports})
	if err != nil {
		return List{}, err
	}
	out := List{Enabled: on, Reports: make([]Report, 0, len(rows))}
	for _, r := range rows {
		if !on {
			out.Reports = append(out.Reports, stubOf(r))
			continue
		}
		rep, err := s.view(ctx, r)
		if err != nil {
			return List{}, err
		}
		out.Reports = append(out.Reports, rep)
	}
	return out, nil
}

// stubOf is a report without anything it found: for the list while the feature is off, and for the result of a cancel then.
func stubOf(r dbgen.ContentHealthReport) Report {
	rep := reportOf(r, nil)
	rep.Signals = []SignalView{}
	return rep
}

// Get returns one report with its per-source coverage.
func (s *Service) Get(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Report, error) {
	d, err := s.Detail(ctx, a, teamRef, id)
	return d.Report, err
}

// Detail returns one report with its per-source coverage.
func (s *Service) Detail(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Detail, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return Detail{}, err
	}
	if err := s.requireEnabled(ctx); err != nil {
		return Detail{}, err
	}
	row, err := s.q.GetContentHealthReport(ctx, dbgen.GetContentHealthReportParams{ID: id, TeamID: acc.Team.ID})
	if err != nil {
		return Detail{}, notFoundReport(err)
	}
	rep, err := s.view(ctx, row)
	if err != nil {
		return Detail{}, err
	}
	srcs, err := s.q.ListContentHealthSources(ctx, dbgen.ListContentHealthSourcesParams{ReportID: id, TeamID: acc.Team.ID})
	if err != nil {
		return Detail{}, err
	}
	out := Detail{Report: rep, Sources: make([]SourceCoverage, len(srcs))}
	for i, c := range srcs {
		out.Sources[i] = SourceCoverage{SourceID: c.SourceID, Name: c.SourceName, Type: c.SourceType, Documents: c.Documents, Ready: c.Ready,
			ReadyNoDate: c.ReadyNoDate, ReadyNoHash: c.ReadyNoHash, LinkState: c.LinkState, LinkReason: c.LinkReason, LinkCrawlAt: c.LinkCrawlAt,
			LinkTruncated: c.LinkTruncated, LinkFailed: c.LinkFailed, LinkRefs: c.LinkRefs, CiteState: c.CiteState, ExposedSince: c.ExposedSince,
			ExposureAnswers: c.ExposureAnswers}
	}
	return out, nil
}

// Findings returns a page of one signal's findings, after the cursor, joined to the team's live sources and documents.
func (s *Service) Findings(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, signal string, after int32, limit int) (FindingsPage, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return FindingsPage{}, err
	}
	if err := s.requireEnabled(ctx); err != nil {
		return FindingsPage{}, err
	}
	if !s.knownSignal(signal) {
		return FindingsPage{}, errSignal
	}
	if _, err := s.q.GetContentHealthReport(ctx, dbgen.GetContentHealthReportParams{ID: id, TeamID: acc.Team.ID}); err != nil {
		return FindingsPage{}, notFoundReport(err)
	}
	if limit <= 0 {
		limit = DefaultPageSize
	}
	limit = min(limit, PageSize)
	// Duplicates page in whole groups (a group never straddles two pages), so a page may hold fewer rows than the limit, and at
	// least one group (at most MaxGroupMembers rows) however small the limit.
	fetch := limit + 1
	if signal == SignalDuplicate {
		fetch = limit + MaxGroupMembers + 1
	}
	rows, err := s.q.ListContentHealthFindings(ctx, dbgen.ListContentHealthFindingsParams{
		ReportID: id, TeamID: acc.Team.ID, Signal: signal, AfterOrd: max(after, 0), PageSize: int32(fetch),
	})
	if err != nil {
		return FindingsPage{}, err
	}
	more := len(rows) > limit
	if signal == SignalDuplicate {
		rows, more = wholeGroups(rows, limit)
	} else if more {
		rows = rows[:limit]
	}
	page := FindingsPage{Items: make([]FindingView, 0, len(rows))}
	for _, r := range rows {
		page.Items = append(page.Items, findingView(r))
	}
	if more && len(rows) > 0 {
		page.After = rows[len(rows)-1].Ord
	}
	return page, nil
}

// wholeGroups keeps duplicate rows (in order) up to the last group that fits the limit, and always the first group. more says
// that rows of later groups remain.
func wholeGroups(rows []dbgen.ListContentHealthFindingsRow, limit int) (kept []dbgen.ListContentHealthFindingsRow, more bool) {
	end := 0
	for end < len(rows) {
		j := end
		for j < len(rows) && rows[j].GroupNo == rows[end].GroupNo {
			j++
		}
		if end > 0 && j > limit {
			break
		}
		end = j
	}
	return rows[:end], end < len(rows)
}

func (s *Service) knownSignal(name string) bool {
	return slices.ContainsFunc(s.signals(), func(sig Signal) bool { return sig.Name() == name })
}

func findingView(r dbgen.ListContentHealthFindingsRow) FindingView {
	v := FindingView{Signal: r.Signal, Ord: r.Ord, SourceID: r.SourceID, SourceName: r.SourceName, SourceType: r.SourceType, Title: r.Title,
		Filename: r.Filename, URL: r.DocUrl, Kind: r.Kind, Ref: r.Ref, GroupNo: r.GroupNo, GroupSize: r.GroupSize, Code: r.Code, Detail: r.Detail,
		Value: r.Value, ObservedAt: r.ObservedAt, ConfirmedAt: r.ConfirmedAt, ChangedSince: r.ChangedSince}
	if r.DocumentID.Valid {
		id := r.DocumentID.UUID
		v.DocumentID = &id
	}
	return v
}

// view converts a stored report, with what is still listed under each signal.
func (s *Service) view(ctx context.Context, r dbgen.ContentHealthReport) (Report, error) {
	listed := map[string]int64{}
	if r.Status == StatusCompleted {
		counts, err := s.q.CountContentHealthFindings(ctx, dbgen.CountContentHealthFindingsParams{ReportID: r.ID, TeamID: r.TeamID})
		if err != nil {
			return Report{}, err
		}
		for _, c := range counts {
			listed[c.Signal] = c.Listed
		}
	}
	return reportOf(r, listed), nil
}

// reportOf converts a stored report; listed is what is still listed per signal (nil: none yet).
func reportOf(r dbgen.ContentHealthReport, listed map[string]int64) Report {
	rep := Report{ID: r.ID, Status: r.Status, StaleDays: int(r.StaleDays), CitationWindowDays: int(r.CitationWindowDays), AsOf: r.AsOf,
		CreatedAt: r.CreatedAt, StartedAt: r.StartedAt, FinishedAt: r.FinishedAt, ExpiresAt: r.ExpiresAt, ErrorCode: r.ErrorCode, Signals: []SignalView{}}
	if r.ScopeSourceID.Valid {
		id := r.ScopeSourceID.UUID
		rep.SourceID = &id
	}
	if r.ScopeKbID.Valid {
		id := r.ScopeKbID.UUID
		rep.KBID = &id
	}
	var stored []storedSignal
	if len(r.Signals) > 0 && json.Unmarshal(r.Signals, &stored) == nil {
		for _, sg := range stored {
			rep.Signals = append(rep.Signals, SignalView{Signal: sg.Signal, State: sg.State, Reason: sg.Reason, Found: sg.Found, Listed: listed[sg.Signal],
				Truncated: sg.Truncated, Counts: sg.Counts, ObservedSince: sg.ObservedSince})
		}
	}
	return rep
}
