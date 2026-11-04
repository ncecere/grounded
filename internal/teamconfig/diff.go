package teamconfig

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

const maxWebhooksPerTeam = 10 // webhooks.maxWebhooksPerScope

var kindOrder = map[string]int{KindSource: 0, KindKnowledgeBase: 1, KindAgent: 2, KindEvaluationSet: 3, KindWebhook: 4}

func sortRows(rows []Row) {
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Kind != rows[j].Kind {
			return kindOrder[rows[i].Kind] < kindOrder[rows[j].Kind]
		}
		return strings.ToLower(rows[i].Key) < strings.ToLower(rows[j].Key)
	})
}

func newRow(kind, key string) Row {
	return Row{Kind: kind, Key: key, Changes: []Change{}, Blockers: []string{}, Notes: []string{}}
}

// finish sets a matched row with nothing to change and nothing blocking to a no-op.
func finish(row Row) Row {
	if row.Action == ActionUpdate && len(row.Changes) == 0 && len(row.Blockers) == 0 {
		row.Action = ActionNoOp
	}
	return row
}

// fields is a value's JSON members, for comparing.
func fields(v any) map[string]json.RawMessage {
	raw, _ := json.Marshal(v)
	m := map[string]json.RawMessage{}
	_ = json.Unmarshal(raw, &m)
	return m
}

// nest adds a member's own members as "prefix.member", in place of the member.
func nest(m map[string]json.RawMessage, prefix string) {
	raw, ok := m[prefix]
	if !ok {
		return
	}
	delete(m, prefix)
	inner := map[string]json.RawMessage{}
	if json.Unmarshal(raw, &inner) != nil {
		m[prefix] = raw
		return
	}
	for k, v := range inner {
		m[prefix+"."+k] = v
	}
}

// changes compares two field maps, skipping some fields, in a stable order.
func changes(cur, next map[string]json.RawMessage, skip ...string) []Change {
	keys := map[string]bool{}
	for k := range cur {
		keys[k] = true
	}
	for k := range next {
		keys[k] = true
	}
	var order []string
	for k := range keys {
		if !slices.Contains(skip, k) {
			order = append(order, k)
		}
	}
	sort.Strings(order)
	out := []Change{}
	for _, k := range order {
		a, b := cur[k], next[k]
		if string(canonical(a)) == string(canonical(b)) {
			continue
		}
		out = append(out, Change{Field: k, From: render(a), To: render(b)})
	}
	return out
}

func render(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return "(not set)"
	}
	s := string(canonical(raw))
	if len(s) > 200 {
		return fmt.Sprintf("(%d characters)", len(s))
	}
	return s
}

// blocker turns a domain refusal into a row's blocker; other errors are the plan's.
func blocker(err error) (string, error) {
	var e *apperr.Error
	if errors.As(err, &e) {
		return e.Message, nil
	}
	return "", err
}

func (s *Service) sourceRows(ctx context.Context, r *resolution) []Row {
	rows := []Row{}
	for _, f := range r.file.Sources {
		row := newRow(KindSource, f.Name)
		_, exists := r.action(KindSource, f.Name, &row)
		if _, ok := r.profiles[f.EmbeddingProfile]; !ok {
			row.Blockers = append(row.Blockers, fmt.Sprintf("This install has no embedding profile with the key %q.", f.EmbeddingProfile))
		}
		if rank, ok := r.ranks[f.Classification]; !ok {
			row.Blockers = append(row.Blockers, fmt.Sprintf("This install has no classification %q.", f.Classification))
		} else if rank > r.ceiling {
			row.Blockers = append(row.Blockers, "Its classification is above what this team is approved for.")
		}
		cur := find(r.current.Sources, func(s Source) string { return s.Name }, f.Name)
		webChanged := cur == nil || string(canonical(mustJSON(cur.Web))) != string(canonical(mustJSON(f.Web)))
		if f.Type == "web" && webChanged && s.Sources != nil {
			if err := s.Sources.CheckWebConfig(ctx, r.team.ID, mustJSON(f.Web)); err != nil {
				b, err := blocker(err)
				if err != nil {
					b = "Its crawl settings could not be checked."
				}
				row.Blockers = append(row.Blockers, b)
			}
		}
		switch {
		case !exists:
			if f.Type == "web" {
				row.Notes = append(row.Notes, "Created paused: start its crawl from the source's page when you are ready.")
			} else {
				row.Notes = append(row.Notes, "Created empty: upload its files from the source's page.")
			}
		case cur != nil:
			if cur.Type != f.Type {
				row.Blockers = append(row.Blockers, "A source's type cannot change. Make a new source with another name instead.")
			}
			if cur.EmbeddingProfile != f.EmbeddingProfile {
				row.Blockers = append(row.Blockers, "A source's embedding profile cannot change here: that is a profile migration (Admin → Embedding profiles).")
			}
			if cur.Status != f.Status {
				row.Notes = append(row.Notes, "Its status stays "+cur.Status+": pause or resume it from the source's page.")
			}
			a, b := fields(*cur), fields(f)
			nest(a, "web")
			nest(b, "web")
			nest(a, "boilerplate")
			nest(b, "boilerplate")
			row.Changes = changes(a, b, "type", "embeddingProfile", "status")
		}
		rows = append(rows, finish(row))
	}
	return append(rows, r.notInFile(KindSource, func(k string) bool {
		return fileHas(r.file.Sources, func(s Source) string { return s.Name }, k)
	})...)
}

func (r *resolution) kbRows() []Row {
	rows := []Row{}
	for _, f := range r.file.KnowledgeBases {
		row := newRow(KindKnowledgeBase, f.Name)
		_, exists := r.action(KindKnowledgeBase, f.Name, &row)
		if _, ok := r.profiles[f.EmbeddingProfile]; !ok {
			row.Blockers = append(row.Blockers, fmt.Sprintf("This install has no embedding profile with the key %q.", f.EmbeddingProfile))
		}
		for _, ref := range f.Sources {
			if ref.Namespace == "platform" {
				if _, ok := r.shared[strings.ToLower(ref.Name)]; !ok {
					row.Blockers = append(row.Blockers, fmt.Sprintf("This install has no platform-shared source called %q.", ref.Name))
				}
			} else if !r.hasSource(ref.Name) {
				row.Blockers = append(row.Blockers, fmt.Sprintf("There is no source called %q in the file or the team.", ref.Name))
			}
		}
		if cur := find(r.current.KnowledgeBases, func(k KnowledgeBase) string { return k.Name }, f.Name); exists && cur != nil {
			if cur.EmbeddingProfile != f.EmbeddingProfile {
				row.Blockers = append(row.Blockers, "A knowledge base's embedding profile cannot change.")
			}
			a, b := fields(*cur), fields(f)
			a["sources"], b["sources"] = sourceList(cur.Sources), sourceList(f.Sources)
			row.Changes = changes(a, b, "embeddingProfile")
		}
		rows = append(rows, finish(row))
	}
	return append(rows, r.notInFile(KindKnowledgeBase, func(k string) bool {
		return fileHas(r.file.KnowledgeBases, func(x KnowledgeBase) string { return x.Name }, k)
	})...)
}

// sourceList is a knowledge base's sources as one comparable, readable value.
func sourceList(refs []SourceRef) json.RawMessage {
	names := make([]string, 0, len(refs))
	for _, r := range refs {
		n := r.Name
		if r.Namespace == "platform" {
			n += " (shared)"
		}
		names = append(names, n)
	}
	sort.Slice(names, func(i, j int) bool { return strings.ToLower(names[i]) < strings.ToLower(names[j]) })
	return mustJSON(names)
}

func (r *resolution) agentRows() []Row {
	rows := []Row{}
	for _, f := range r.file.Agents {
		row := newRow(KindAgent, f.Slug)
		row.Title = f.Name
		_, exists := r.action(KindAgent, f.Slug, &row)
		if m := f.Draft.Model; m != nil {
			if model, ok := r.models[*m]; !ok || model.Kind != "chat" {
				row.Blockers = append(row.Blockers, fmt.Sprintf("This install has no chat model %q on the connection %q.", m.Name, m.Connection))
			} else if !model.Enabled {
				row.Blockers = append(row.Blockers, fmt.Sprintf("The chat model %q is turned off in this install.", m.Name))
			}
		}
		for _, k := range f.Draft.KnowledgeBases {
			if !r.hasKB(k.Name) {
				row.Blockers = append(row.Blockers, fmt.Sprintf("There is no knowledge base called %q in the file or the team.", k.Name))
			}
		}
		cur := find(r.current.Agents, func(a Agent) string { return a.Slug }, f.Slug)
		if f.Status != "active" && (cur == nil || cur.Status != f.Status) {
			row.Notes = append(row.Notes, "Its status is not changed by a file: turn an agent off or on from its menu.")
		}
		if !exists {
			row.Notes = append(row.Notes, "Created as a draft: publish it from the agent's page when you are ready.")
		} else if cur != nil {
			a, b := agentFields(*cur), agentFields(f)
			row.Changes = changes(a, b, "status", "slug", "versions", "publishedVersion")
			if cur.PublishedVersion != 0 && hasDraftChange(row.Changes) {
				row.Notes = append(row.Notes, "Only the draft changes: people keep using the published version until you publish again.")
			}
		}
		rows = append(rows, finish(row))
	}
	kept := r.notInFile(KindAgent, func(k string) bool {
		return fileHas(r.file.Agents, func(a Agent) string { return a.Slug }, k)
	})
	for i := range kept {
		if cur := find(r.current.Agents, func(a Agent) string { return a.Slug }, kept[i].Key); cur != nil {
			kept[i].Title = cur.Name
		}
	}
	return append(rows, kept...)
}

// agentFields flattens an agent for comparing: its profile, then its draft's model, knowledge bases and each setting,
// with the file's settings normalized the way saving them would (omitted settings take their defaults).
func agentFields(a Agent) map[string]json.RawMessage {
	m := fields(a)
	delete(m, "draft")
	m["draft.model"] = mustJSON(a.Draft.Model)
	m["draft.knowledgeBases"] = mustJSON(a.Draft.KnowledgeBases)
	for k, v := range normalizedSettings(a.Draft.Settings) {
		m["draft.settings."+k] = v
	}
	return m
}

func normalizedSettings(raw json.RawMessage) map[string]json.RawMessage {
	settings := map[string]json.RawMessage{}
	if cfg, err := agents.ParseConfig(raw); err == nil {
		_ = json.Unmarshal(omitNullMembers(cfg.JSON()), &settings)
	}
	for _, k := range []string{"chatModelId", "kbs", "tools"} {
		delete(settings, k)
	}
	for k, v := range settings {
		if string(v) == "null" {
			delete(settings, k)
		}
	}
	return settings
}

func hasDraftChange(cs []Change) bool {
	for _, c := range cs {
		if strings.HasPrefix(c.Field, "draft.") {
			return true
		}
	}
	return false
}

func (r *resolution) evaluationRows() []Row {
	rows := []Row{}
	for _, f := range r.file.EvaluationSets {
		row := newRow(KindEvaluationSet, f.Name)
		_, exists := r.action(KindEvaluationSet, f.Name, &row)
		if r.evalsDenied {
			row.Blockers = append(row.Blockers, "Evaluation sets can be applied only by a signed-in editor while evaluations are switched on (API keys never reach evaluation questions).")
		}
		if f.KnowledgeBase != "" && !r.hasKB(f.KnowledgeBase) {
			row.Blockers = append(row.Blockers, fmt.Sprintf("There is no knowledge base called %q in the file or the team.", f.KnowledgeBase))
		}
		if f.Agent != "" && !r.hasAgent(f.Agent) {
			row.Blockers = append(row.Blockers, fmt.Sprintf("There is no agent with the address %q in the file or the team.", f.Agent))
		}
		if cur := find(r.current.EvaluationSets, func(s EvaluationSet) string { return s.Name }, f.Name); exists && cur != nil {
			if !strings.EqualFold(cur.KnowledgeBase, f.KnowledgeBase) || !strings.EqualFold(cur.Agent, f.Agent) {
				row.Blockers = append(row.Blockers, "An evaluation set's knowledge base or agent cannot change. Make a new set with another name instead.")
			}
			a, b := fields(*cur), fields(f)
			row.Changes = changes(a, b, "cases", "knowledgeBase", "agent")
			added, changed, kept := caseChanges(cur.Cases, f.Cases)
			if added+changed > 0 {
				row.Changes = append(row.Changes, Change{Field: "questions", From: fmt.Sprint(len(cur.Cases)), To: fmt.Sprintf("%d added, %d changed", added, changed)})
			}
			if kept > 0 {
				row.Notes = append(row.Notes, fmt.Sprintf("%d question(s) not in the file stay as they are.", kept))
			}
		} else if !exists {
			row.Notes = append(row.Notes, fmt.Sprintf("Created with %d question(s); nothing runs until you start a run.", len(f.Cases)))
		}
		rows = append(rows, finish(row))
	}
	if r.evalsHidden {
		return rows
	}
	return append(rows, r.notInFile(KindEvaluationSet, func(k string) bool {
		return fileHas(r.file.EvaluationSets, func(s EvaluationSet) string { return s.Name }, k)
	})...)
}

// caseChanges matches questions by their exact text: new text is added, the same text with other expectations is
// changed, and questions only in the team are kept.
func caseChanges(cur, next []EvaluationCase) (added, changed, kept int) {
	byQuestion := map[string]EvaluationCase{}
	for _, c := range cur {
		byQuestion[c.Question] = c
	}
	inFile := map[string]bool{}
	for _, c := range next {
		inFile[c.Question] = true
		old, ok := byQuestion[c.Question]
		switch {
		case !ok:
			added++
		case string(mustJSON(old)) != string(mustJSON(c)):
			changed++
		}
	}
	for q := range byQuestion {
		if !inFile[q] {
			kept++
		}
	}
	return added, changed, kept
}

func (s *Service) webhookRows(ctx context.Context, q *dbgen.Queries, r *resolution) []Row {
	rows := []Row{}
	total := 0
	for _, list := range r.objects[KindWebhook] {
		total += len(list)
	}
	for _, f := range r.file.Webhooks {
		row := newRow(KindWebhook, f.URL)
		_, exists := r.action(KindWebhook, f.URL, &row)
		if !r.webhooksOn {
			row.Blockers = append(row.Blockers, "Webhooks are switched off on this platform.")
		}
		if !exists {
			total++
			if total > maxWebhooksPerTeam {
				row.Blockers = append(row.Blockers, fmt.Sprintf("A team can have at most %d webhooks.", maxWebhooksPerTeam))
			}
			if s.Webhooks != nil {
				if err := s.Webhooks.CheckURL(ctx, q, f.URL); err != nil {
					b, _ := blocker(err)
					if b == "" {
						b = "This address could not be checked."
					}
					row.Blockers = append(row.Blockers, b)
				}
			}
			row.Notes = append(row.Notes, "Created turned off, with a new signing secret shown once after applying.")
		} else if i := slices.IndexFunc(r.current.Webhooks, func(w Webhook) bool { return w.URL == f.URL }); i >= 0 {
			cur := &r.current.Webhooks[i]
			a, b := fields(*cur), fields(f)
			a["events"], b["events"] = sortedJSON(cur.Events), sortedJSON(f.Events)
			row.Changes = changes(a, b, "enabled", "url")
			if cur.Enabled != f.Enabled {
				row.Notes = append(row.Notes, "Whether it is on is not changed by a file: turn it on or off from the webhook's page.")
			}
		}
		rows = append(rows, finish(row))
	}
	return append(rows, r.notInFile(KindWebhook, func(k string) bool {
		return slices.ContainsFunc(r.file.Webhooks, func(w Webhook) bool { return w.URL == k })
	})...)
}

func sortedJSON(list []string) json.RawMessage {
	c := slices.Clone(list)
	sort.Strings(c)
	return mustJSON(c)
}

func mustJSON(v any) json.RawMessage {
	raw, _ := json.Marshal(v)
	return raw
}

// find is the current object of a file row (nil when the team has none, or a lenient load left it out).
func find[T any](items []T, key func(T) string, want string) *T {
	for i := range items {
		if strings.EqualFold(key(items[i]), want) {
			return &items[i]
		}
	}
	return nil
}
