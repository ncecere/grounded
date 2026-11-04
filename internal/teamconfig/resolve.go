package teamconfig

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// resolution is everything one plan read: the file, the team's current configuration and identities, and the install's
// references. Apply recomputes it inside its own transaction and acts on that copy only.
type resolution struct {
	actor       authz.Actor
	team        dbgen.Team
	file        Document
	current     Document
	skipped     map[string]map[string]string
	evalsDenied bool // the caller may not write evaluation sets
	evalsHidden bool // ... and the team has some, not compared
	// objects: the team's objects by kind and folded identity (several for an ambiguous name or URL).
	objects    map[string]map[string][]dbgen.ConfigurationTeamObjectsRow
	profiles   map[string]uuid.UUID // embedding profile key
	ranks      map[string]int32     // classification key -> rank
	ceiling    int32                // the team's approved classification rank
	models     map[ModelRef]dbgen.ConfigurationModelsRow
	shared     map[string]uuid.UUID // platform-shared source, lower-case name
	webhooksOn bool
}

// object is the team's one object of a kind and identity; ok is false when there is none, ambiguous when several.
func (r *resolution) object(kind, key string) (row dbgen.ConfigurationTeamObjectsRow, ok, ambiguous bool) {
	rows := r.objects[kind][foldKey(kind, key)]
	if len(rows) == 1 {
		return rows[0], true, false
	}
	return row, false, len(rows) > 1
}

func (r *resolution) hasSource(name string) bool {
	if _, ok, _ := r.object(KindSource, name); ok {
		return true
	}
	return fileHas(r.file.Sources, func(s Source) string { return s.Name }, name)
}

func (r *resolution) hasKB(name string) bool {
	if _, ok, _ := r.object(KindKnowledgeBase, name); ok {
		return true
	}
	return fileHas(r.file.KnowledgeBases, func(k KnowledgeBase) string { return k.Name }, name)
}

func (r *resolution) hasAgent(slug string) bool {
	if _, ok, _ := r.object(KindAgent, slug); ok {
		return true
	}
	return fileHas(r.file.Agents, func(a Agent) string { return a.Slug }, slug)
}

func fileHas[T any](items []T, key func(T) string, want string) bool {
	for _, it := range items {
		if strings.EqualFold(key(it), want) {
			return true
		}
	}
	return false
}

// compute builds the plan for a file against a team, reading through q (a read-only snapshot when planning, the
// apply transaction when applying).
func (s *Service) compute(ctx context.Context, q *dbgen.Queries, a authz.Actor, t dbgen.Team, file Document) (Plan, *resolution, error) {
	l := &loader{q: q, team: t.ID, actor: a, skipped: map[string]map[string]string{}}
	current, err := l.load(ctx)
	if err != nil {
		return Plan{}, nil, err
	}
	r := &resolution{actor: a, team: t, file: file, current: current, skipped: l.skipped, evalsDenied: l.evalsDenied, evalsHidden: l.evalsHidden}
	if err := s.references(ctx, q, r); err != nil {
		return Plan{}, nil, err
	}
	p := Plan{Rows: []Row{}, Notes: []string{"Nothing in the team is deleted or renamed: objects that are not in the file stay as they are."}}
	if r.evalsHidden {
		p.Notes = append(p.Notes, "Evaluation sets are not compared: API keys cannot read evaluation questions, or evaluations are switched off.")
	}
	for _, rows := range [][]Row{
		s.sourceRows(ctx, r), r.kbRows(), r.agentRows(), r.evaluationRows(), s.webhookRows(ctx, q, r),
	} {
		p.Rows = append(p.Rows, rows...)
	}
	if anyVersions(file) {
		p.Notes = append(p.Notes, "Agent versions in the file are history: importing changes drafts only and publishes nothing.")
	}
	p.count()
	p.PlanDigest = digest(t.ID.String(), file, current, r.skipped, p.Rows)
	return p, r, nil
}

func anyVersions(d Document) bool {
	for _, a := range d.Agents {
		if len(a.Versions) > 0 || a.PublishedVersion != 0 {
			return true
		}
	}
	return false
}

// references reads the team's identities and what a file may refer to in this install.
func (s *Service) references(ctx context.Context, q *dbgen.Queries, r *resolution) error {
	objs, err := q.ConfigurationTeamObjects(ctx, r.team.ID)
	if err != nil {
		return err
	}
	r.objects = map[string]map[string][]dbgen.ConfigurationTeamObjectsRow{}
	for _, o := range objs {
		if r.objects[o.Kind] == nil {
			r.objects[o.Kind] = map[string][]dbgen.ConfigurationTeamObjectsRow{}
		}
		k := foldKey(o.Kind, o.Key)
		r.objects[o.Kind][k] = append(r.objects[o.Kind][k], o)
	}
	profiles, err := q.ConfigurationProfiles(ctx)
	if err != nil {
		return err
	}
	r.profiles = map[string]uuid.UUID{}
	for _, p := range profiles {
		r.profiles[p.Key] = p.ID
	}
	levels, err := q.ListClassifications(ctx)
	if err != nil {
		return err
	}
	r.ranks = map[string]int32{}
	for _, c := range levels {
		r.ranks[c.Key] = c.Rank
	}
	r.ceiling = r.ranks[r.team.MaxClassification]
	models, err := q.ConfigurationModels(ctx)
	if err != nil {
		return err
	}
	r.models = map[ModelRef]dbgen.ConfigurationModelsRow{}
	for _, m := range models {
		r.models[ModelRef{Connection: m.Connection, Name: m.Key}] = m
	}
	shared, err := q.ConfigurationSharedSources(ctx)
	if err != nil {
		return err
	}
	r.shared = map[string]uuid.UUID{}
	for _, sh := range shared {
		r.shared[strings.ToLower(sh.Name)] = sh.ID
	}
	if s.Webhooks != nil {
		if r.webhooksOn, err = s.Webhooks.Enabled(ctx); err != nil {
			return err
		}
	}
	return nil
}

// skippedBlocker is the blocker for a file row whose team object a file cannot carry yet.
func (r *resolution) skippedBlocker(kind, key string) string {
	if reason := r.skipped[kind][foldKey(kind, key)]; reason != "" {
		return "This " + kindLabel(kind) + " cannot be changed from a file: " + reason + ". Change it in the app."
	}
	return ""
}

func kindLabel(kind string) string {
	switch kind {
	case KindKnowledgeBase:
		return "knowledge base"
	case KindEvaluationSet:
		return "evaluation set"
	}
	return kind
}

// action says create or update for a file row, and blocks it when the team's match is ambiguous or not carried.
func (r *resolution) action(kind, key string, row *Row) (dbgen.ConfigurationTeamObjectsRow, bool) {
	obj, ok, ambiguous := r.object(kind, key)
	switch {
	case ambiguous:
		row.Blockers = append(row.Blockers, "The team has more than one "+kindLabel(kind)+" called this, so the file cannot say which one it means.")
	case ok:
		row.Action = ActionUpdate
	default:
		row.Action = ActionCreate
	}
	if ambiguous {
		row.Action = ActionUpdate
	}
	if b := r.skippedBlocker(kind, key); b != "" {
		row.Blockers = append(row.Blockers, b)
	}
	return obj, ok
}

// notInFile lists the team's objects of a kind that the file does not mention: shown, never deleted.
func (r *resolution) notInFile(kind string, inFile func(string) bool) []Row {
	var rows []Row
	for _, list := range r.objects[kind] {
		for _, o := range list {
			if inFile(o.Key) {
				continue
			}
			row := Row{Kind: kind, Key: o.Key, Action: ActionNotInFile, Changes: []Change{}, Blockers: []string{}, Notes: []string{"Not in the file: it stays as it is."}}
			rows = append(rows, row)
		}
	}
	sortRows(rows)
	return rows
}
