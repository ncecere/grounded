package teamconfig

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"

	"github.com/google/uuid"
	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/web"
)

func newWebConfig() *web.Config { return &web.Config{} }

func portableConfig(ctx context.Context, q *dbgen.Queries, raw json.RawMessage, names map[uuid.UUID]string) (AgentConfig, error) {
	if checkFields(raw, reflect.TypeOf(agents.Config{})) != nil {
		return AgentConfig{}, errUnsupported
	}
	var stored agents.Config
	if strictJSON(raw, &stored) != nil {
		return AgentConfig{}, errUnsupported
	}
	if _, err := agents.ParseConfig(raw); err != nil || len(stored.Tools) > 0 || !portableFilters(stored) {
		return AgentConfig{}, errUnsupported
	}
	var m map[string]json.RawMessage
	if strictJSON(raw, &m) != nil {
		return AgentConfig{}, errUnsupported
	}
	out := AgentConfig{KnowledgeBases: []KBRef{}}
	if stored.ChatModelID != nil {
		model, err := q.ExportConfigurationModel(ctx, *stored.ChatModelID)
		if err != nil {
			return out, errUnsupported
		}
		out.Model = &ModelRef{Connection: model.Connection, Name: model.Name}
	}
	for _, r := range stored.KBs {
		name, ok := names[r.KBID]
		if !ok {
			return out, errUnsupported
		}
		out.KnowledgeBases = append(out.KnowledgeBases, KBRef{Name: name, TopK: r.TopK})
	}
	delete(m, "chatModelId")
	delete(m, "kbs")
	delete(m, "tools")
	// Null optional overrides mean inherit. Omit them instead of emitting YAML
	// null (which the hostile-input boundary deliberately rejects).
	for k, v := range m {
		if string(v) == "null" {
			delete(m, k)
		}
	}
	out.Settings, _ = json.Marshal(m)
	out.Settings = omitNullMembers(out.Settings)
	return out, nil
}

func (l *loader) loadAgents(ctx context.Context, names map[uuid.UUID]string, d *Document) error {
	rows, err := l.q.ExportConfigurationAgents(ctx, l.team)
	if err != nil {
		return err
	}
	if len(rows)+len(d.Sources)+len(d.KnowledgeBases) > MaxResources {
		return errUnsupported
	}
	indices := map[uuid.UUID]int{}
	published := map[uuid.UUID]uuid.UUID{}
	slugs := map[uuid.UUID]string{}
	for _, r := range rows {
		slugs[r.ID] = r.Slug
		reason := ""
		var config AgentConfig
		switch {
		case r.CacheSettings:
			reason = "it has saved-answer settings, which files do not carry yet"
		case r.ShortNames:
			reason = "it has short names, which files do not carry yet"
		default:
			if config, err = portableConfig(ctx, l.q, r.Draft, names); err != nil {
				reason = "its draft uses MCP tools, source filters by ID or another setting files do not carry yet"
			}
		}
		if reason != "" {
			if err := l.refuse(KindAgent, r.Slug, reason); err != nil {
				return err
			}
			continue
		}
		indices[r.ID] = len(d.Agents)
		if r.PublishedVersionID.Valid {
			published[r.ID] = r.PublishedVersionID.UUID
		}
		starters := r.StarterQuestions
		if starters == nil {
			starters = []string{}
		}
		d.Agents = append(d.Agents, Agent{Name: r.Name, Slug: r.Slug, Description: r.Description, AccentColor: r.AccentColor, WelcomeMessage: r.WelcomeMessage, StarterQuestions: starters, Status: r.Status, Draft: config, Versions: []AgentVersion{}})
	}
	versions, err := l.q.ExportConfigurationVersions(ctx, l.team)
	if err != nil {
		return err
	}
	if len(versions) > MaxSequenceItems {
		return errUnsupported
	}
	dropped := map[uuid.UUID]bool{}
	for _, v := range versions {
		i, ok := indices[v.AgentID]
		if !ok || dropped[v.AgentID] {
			continue // the agent itself was left out (lenient) or already dropped
		}
		config, err := portableConfig(ctx, l.q, v.Config, names)
		if err != nil || v.EffectiveRank > v.CeilingRank {
			if err := l.refuse(KindAgent, slugs[v.AgentID], "a published version uses settings files do not carry yet"); err != nil {
				return err
			}
			dropped[v.AgentID] = true
			continue
		}
		d.Agents[i].Versions = append(d.Agents[i].Versions, AgentVersion{Version: v.Version, Note: v.Note, Config: config})
		if published[v.AgentID] == v.ID {
			d.Agents[i].PublishedVersion = v.Version
		}
	}
	for id := range published {
		if !dropped[id] && d.Agents[indices[id]].PublishedVersion == 0 {
			return errUnsupported
		}
	}
	if len(dropped) > 0 {
		kept := d.Agents[:0]
		for _, ag := range d.Agents {
			if l.skipped[KindAgent][foldKey(KindAgent, ag.Slug)] == "" {
				kept = append(kept, ag)
			}
		}
		d.Agents = kept
	}
	return nil
}

func (l *loader) loadEvaluations(ctx context.Context, d *Document) error {
	if l.evalsHidden {
		return nil
	}
	rows, err := l.q.ExportConfigurationEvalSets(ctx, l.team)
	if err != nil {
		return err
	}
	if len(rows)+len(d.Sources)+len(d.KnowledgeBases)+len(d.Agents) > MaxResources {
		return errUnsupported
	}
	total := 0
	seen := map[string]bool{}
	for _, r := range rows {
		cases, err := l.q.ExportConfigurationCases(ctx, dbgen.ExportConfigurationCasesParams{TeamID: l.team, ID: r.ID})
		if err != nil {
			return err
		}
		total += len(cases)
		if total > MaxSequenceItems {
			return errUnsupported
		}
		key := strings.ToLower(r.Name)
		reason := ""
		if seen[key] {
			reason = "another evaluation set of this team has the same name"
		}
		seen[key] = true
		out := EvaluationSet{Name: r.Name, Description: r.Description, KnowledgeBase: r.Kb, Agent: r.Agent, AutoRun: r.AutoRun, Cases: []EvaluationCase{}}
		for _, c := range cases {
			var expected evals.Expected
			if strictJSON(c.Expected, &expected) != nil || len(expected.DocumentIDs) > 0 || len(expected.Filenames) > 0 {
				reason = "a question expects a picked document or file name, which files do not carry (only page addresses)"
				break
			}
			urls := expected.URLs
			if urls == nil {
				urls = []string{}
			}
			phrases := c.MustMention
			if phrases == nil {
				phrases = []string{}
			}
			out.Cases = append(out.Cases, EvaluationCase{Question: c.Question, URLs: urls, MustMention: phrases, Note: c.Note})
		}
		if reason != "" {
			if err := l.refuse(KindEvaluationSet, r.Name, reason); err != nil {
				return err
			}
			continue
		}
		d.EvaluationSets = append(d.EvaluationSets, out)
	}
	if !l.strict {
		kept := d.EvaluationSets[:0]
		for _, s := range d.EvaluationSets {
			if l.skipped[KindEvaluationSet][foldKey(KindEvaluationSet, s.Name)] == "" {
				kept = append(kept, s)
			}
		}
		d.EvaluationSets = kept
	}
	return nil
}

// Omitted and null optional object members both mean inherit in stored domain
// JSON. The v1 syntax deliberately admits omission but never YAML null.
func omitNullMembers(raw json.RawMessage) json.RawMessage {
	var value any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if dec.Decode(&value) != nil {
		return raw
	}
	cleanNulls(value)
	out, _ := json.Marshal(value)
	return out
}
func cleanNulls(v any) {
	switch x := v.(type) {
	case map[string]any:
		for k, child := range x {
			if child == nil {
				delete(x, k)
			} else {
				cleanNulls(child)
			}
		}
	case []any:
		for _, child := range x {
			cleanNulls(child)
		}
	}
}
