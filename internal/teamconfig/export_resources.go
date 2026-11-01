package teamconfig

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"

	"github.com/google/uuid"
	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/authz"
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

func loadAgents(ctx context.Context, q *dbgen.Queries, team uuid.UUID, names map[uuid.UUID]string, d *Document) error {
	rows, err := q.ExportConfigurationAgents(ctx, team)
	if err != nil {
		return err
	}
	if len(rows)+len(d.Sources)+len(d.KnowledgeBases) > MaxResources {
		return errUnsupported
	}
	indices := map[uuid.UUID]int{}
	published := map[uuid.UUID]uuid.UUID{}
	for _, r := range rows {
		if r.CacheSettings || r.ShortNames {
			return errUnsupported
		}
		config, err := portableConfig(ctx, q, r.Draft, names)
		if err != nil {
			return err
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
	versions, err := q.ExportConfigurationVersions(ctx, team)
	if err != nil {
		return err
	}
	if len(versions) > MaxSequenceItems {
		return errUnsupported
	}
	for _, v := range versions {
		if v.EffectiveRank > v.CeilingRank {
			return errUnsupported
		}
		config, err := portableConfig(ctx, q, v.Config, names)
		if err != nil {
			return err
		}
		i, ok := indices[v.AgentID]
		if !ok {
			return errUnsupported
		}
		d.Agents[i].Versions = append(d.Agents[i].Versions, AgentVersion{Version: v.Version, Note: v.Note, Config: config})
		if published[v.AgentID] == v.ID {
			d.Agents[i].PublishedVersion = v.Version
		}
	}
	for id := range published {
		if d.Agents[indices[id]].PublishedVersion == 0 {
			return errUnsupported
		}
	}
	return nil
}

func loadEvaluations(ctx context.Context, q *dbgen.Queries, team uuid.UUID, a authz.Actor, d *Document) error {
	rows, err := q.ExportConfigurationEvalSets(ctx, team)
	if err != nil {
		return err
	}
	if len(rows)+len(d.Sources)+len(d.KnowledgeBases)+len(d.Agents) > MaxResources {
		return errUnsupported
	}
	// Reconcile the existing evaluation policy without letting export scope
	// expose protected questions to API keys. Keys may export teams without sets.
	if len(rows) > 0 {
		if a.Key != nil {
			return errUnsupported
		}
		settings, err := q.GetEvaluationSettings(ctx)
		if err != nil {
			return err
		}
		if !settings.Enabled {
			return errUnsupported
		}
	}
	total := 0
	for _, r := range rows {
		cases, err := q.ExportConfigurationCases(ctx, dbgen.ExportConfigurationCasesParams{TeamID: team, ID: r.ID})
		if err != nil {
			return err
		}
		total += len(cases)
		if total > MaxSequenceItems {
			return errUnsupported
		}
		out := EvaluationSet{Name: r.Name, Description: r.Description, KnowledgeBase: r.Kb, Agent: r.Agent, AutoRun: r.AutoRun, Cases: []EvaluationCase{}}
		for _, c := range cases {
			var expected evals.Expected
			if strictJSON(c.Expected, &expected) != nil || len(expected.DocumentIDs) > 0 || len(expected.Filenames) > 0 {
				return errUnsupported
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
		d.EvaluationSets = append(d.EvaluationSets, out)
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
