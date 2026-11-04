package teamconfig

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/sources"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/webhooks"
)

// Applied is what an apply did: the plan it carried out, and the signing secret of each webhook it made (shown once,
// as when a webhook is made by hand).
type Applied struct {
	Plan           Plan            `json:"plan"`
	WebhookSecrets []WebhookSecret `json:"webhookSecrets"`
}

type WebhookSecret struct {
	URL    string `json:"url"`
	Secret string `json:"secret"`
}

// Apply carries out a file in one transaction (§2): under the team's lock it recomputes the plan from the file with the
// caller's own current grants, refuses with 412 and the fresh plan if the digest differs from ifMatch, refuses with 409
// while any row is blocked, then makes every change through the domain services. A failure rolls everything back.
// Re-applying an applied file finds nothing to do and writes nothing.
func (s *Service) Apply(ctx context.Context, a authz.Actor, teamRef string, body io.Reader, ifMatch string) (Applied, error) {
	file, err := decodeFile(body)
	if err != nil {
		return Applied{}, err
	}
	if ifMatch = strings.Trim(strings.TrimSpace(ifMatch), `"`); ifMatch == "" {
		return Applied{}, apperr.New(428, "plan_required", "Check the changes first, then apply with the plan's digest in If-Match")
	}
	var out Applied
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		t, err := access(ctx, q, a, teamRef, authz.ScopeConfigurationApply)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "teamconfig:"+t.ID.String()); err != nil {
			return err
		}
		p, r, err := s.compute(ctx, q, a, t, file)
		if err != nil {
			return err
		}
		if p.PlanDigest != ifMatch {
			return &apperr.Error{Status: 412, Code: "configuration_changed",
				Message: "The team or the install changed since these changes were checked. Review the new plan and apply again.",
				Details: map[string]any{"plan": p}}
		}
		if p.Counts.Blocked > 0 {
			return &apperr.Error{Status: 409, Code: "configuration_blocked",
				Message: "Some changes cannot be made. Fix what each blocked row says and check again.", Details: map[string]any{"plan": p}}
		}
		x := &executor{s: s, q: q, tx: tx, a: a, r: r, team: t.Slug, plan: p}
		if out.WebhookSecrets, err = x.run(ctx); err != nil {
			return err
		}
		out.Plan = p
		if p.Counts.Create+p.Counts.Update == 0 {
			return nil // nothing changed: no audit entry (as for a no-op edit, #132)
		}
		e := a.Audit("team.configuration_apply", "team", t.ID.String())
		e.TeamID = t.ID
		e.Metadata = map[string]any{"planDigest": p.PlanDigest, "created": p.Counts.Create, "updated": p.Counts.Update}
		return audit.Record(ctx, q, e)
	})
	if out.WebhookSecrets == nil {
		out.WebhookSecrets = []WebhookSecret{}
	}
	return out, err
}

// executor makes a plan's changes in dependency order: sources, knowledge bases, agents, evaluation sets, webhooks.
type executor struct {
	s    *Service
	q    *dbgen.Queries
	tx   pgx.Tx
	a    authz.Actor
	r    *resolution
	team string
	plan Plan
	// made: objects created by this apply, by kind and folded identity, so later rows can refer to them.
	made map[string]map[string]uuid.UUID
}

func (x *executor) id(kind, key string) uuid.UUID {
	if id, ok := x.made[kind][foldKey(kind, key)]; ok {
		return id
	}
	obj, _, _ := x.r.object(kind, key)
	return obj.ID
}

func (x *executor) remember(kind, key string, id uuid.UUID) {
	if x.made[kind] == nil {
		x.made[kind] = map[string]uuid.UUID{}
	}
	x.made[kind][foldKey(kind, key)] = id
}

// row is the plan row of a file object.
func (x *executor) row(kind, key string) Row {
	for _, r := range x.plan.Rows {
		if r.Kind == kind && r.Action != ActionNotInFile && foldKey(kind, r.Key) == foldKey(kind, key) {
			return r
		}
	}
	return Row{Action: ActionNoOp}
}

// failed names the object an apply stopped at; the domain error says why.
func failed(kind, key string, err error) error {
	var e *apperr.Error
	if errors.As(err, &e) {
		out := *e
		out.Message = "Applying the " + kindLabel(kind) + " “" + key + "” stopped: " + e.Message
		out.Details = map[string]any{"kind": kind, "key": key}
		return &out
	}
	return err
}

func (x *executor) run(ctx context.Context) ([]WebhookSecret, error) {
	x.made = map[string]map[string]uuid.UUID{}
	for _, step := range []func(context.Context) error{x.sources, x.kbs, x.agents, x.evaluations} {
		if err := step(ctx); err != nil {
			return nil, err
		}
	}
	return x.webhooks(ctx)
}

func (x *executor) sources(ctx context.Context) error {
	for _, f := range x.r.file.Sources {
		row := x.row(KindSource, f.Name)
		var web json.RawMessage
		if f.Web != nil {
			web = mustJSON(f.Web)
		}
		bp, err := boilerplateSettings(f.Boilerplate)
		if err != nil {
			return failed(KindSource, f.Name, err)
		}
		ocr := f.OCREnabled
		switch row.Action {
		case ActionCreate:
			pid := x.r.profiles[f.EmbeddingProfile]
			src, err := x.s.Sources.CreateImportedTx(ctx, x.q, x.tx, x.a, sources.Team(x.team), sources.CreateInput{
				Name: f.Name, Description: f.Description, Type: f.Type, Classification: f.Classification,
				ProfileID: &pid, Web: web, Boilerplate: &bp, OCREnabled: &ocr})
			if err != nil {
				return failed(KindSource, f.Name, err)
			}
			x.remember(KindSource, f.Name, src.ID)
		case ActionUpdate:
			obj, _, _ := x.r.object(KindSource, f.Name)
			name, desc, class := f.Name, f.Description, f.Classification
			if _, err := x.s.Sources.UpdateTx(ctx, x.q, x.tx, x.a, sources.Team(x.team), obj.ID, sources.UpdateInput{
				Name: &name, Description: &desc, Classification: &class, Web: web, Boilerplate: &bp, OCREnabled: &ocr}, obj.Revision); err != nil {
				return failed(KindSource, f.Name, err)
			}
		}
	}
	return nil
}

func boilerplateSettings(b Boilerplate) (boilerplate.Settings, error) {
	out := boilerplate.Settings{Enabled: b.Enabled, MinDocs: b.MinDocs, Fuzzy: b.Fuzzy}
	if b.Ratio != nil {
		f, err := b.Ratio.Float64()
		if err != nil {
			return out, apperr.Invalid("invalid_boilerplate", "The repeated-block ratio is not a number")
		}
		out.Ratio = &f
	}
	return out, nil
}

func (x *executor) kbs(ctx context.Context) error {
	for _, f := range x.r.file.KnowledgeBases {
		row := x.row(KindKnowledgeBase, f.Name)
		in := kbs.Input{Name: f.Name, Description: f.Description, TopK: f.TopK, DefaultWeights: f.VectorWeight == nil}
		if f.VectorWeight != nil {
			v, _ := f.VectorWeight.Float64()
			k, _ := f.KeywordWeight.Float64()
			in.Weights = &kbs.Weights{Vector: v, Keyword: k}
		}
		var kbID uuid.UUID
		switch row.Action {
		case ActionCreate:
			pid := x.r.profiles[f.EmbeddingProfile]
			in.ProfileID = &pid
			kb, err := x.s.KBs.CreateTx(ctx, x.q, x.tx, x.a, x.team, in)
			if err != nil {
				return failed(KindKnowledgeBase, f.Name, err)
			}
			kbID = kb.ID
			x.remember(KindKnowledgeBase, f.Name, kbID)
		case ActionUpdate:
			obj, _, _ := x.r.object(KindKnowledgeBase, f.Name)
			kbID = obj.ID
			if _, err := x.s.KBs.UpdateTx(ctx, x.q, x.tx, x.a, x.team, kbID, in, obj.Revision); err != nil {
				return failed(KindKnowledgeBase, f.Name, err)
			}
		default:
			continue
		}
		if err := x.linkSources(ctx, kbID, f); err != nil {
			return failed(KindKnowledgeBase, f.Name, err)
		}
	}
	return nil
}

// linkSources makes a knowledge base search exactly the file's sources: a source's list is one of its settings, so
// sources not listed are detached (they are not deleted).
func (x *executor) linkSources(ctx context.Context, kbID uuid.UUID, f KnowledgeBase) error {
	have, err := x.q.ConfigurationKBSourceIDs(ctx, kbID)
	if err != nil {
		return err
	}
	want := map[uuid.UUID]bool{}
	for _, ref := range f.Sources {
		id := x.r.shared[strings.ToLower(ref.Name)]
		if ref.Namespace == "team" {
			id = x.id(KindSource, ref.Name)
		}
		want[id] = true
	}
	current := map[uuid.UUID]bool{}
	for _, id := range have {
		current[id] = true
		if !want[id] {
			if err := x.s.KBs.DetachSourceTx(ctx, x.q, x.tx, x.a, x.team, kbID, id); err != nil {
				return err
			}
		}
	}
	for _, ref := range f.Sources { // in the file's order, so attach audits read in that order
		id := x.r.shared[strings.ToLower(ref.Name)]
		if ref.Namespace == "team" {
			id = x.id(KindSource, ref.Name)
		}
		if !current[id] {
			current[id] = true
			if err := x.s.KBs.AttachSourceTx(ctx, x.q, x.tx, x.a, x.team, kbID, id); err != nil {
				return err
			}
		}
	}
	return nil
}

func (x *executor) agents(ctx context.Context) error {
	for _, f := range x.r.file.Agents {
		row := x.row(KindAgent, f.Slug)
		if row.Action != ActionCreate && row.Action != ActionUpdate {
			continue
		}
		cfg, err := x.agentConfig(f.Draft)
		if err != nil {
			return failed(KindAgent, f.Slug, err)
		}
		name, slug, desc, accent, welcome, starters := f.Name, f.Slug, f.Description, f.AccentColor, f.WelcomeMessage, f.StarterQuestions
		profile := agents.Profile{Name: &name, Slug: &slug, Description: &desc, AccentColor: &accent, WelcomeMessage: &welcome, StarterQuestions: &starters}
		if row.Action == ActionCreate {
			ag, err := x.s.Agents.CreateTx(ctx, x.q, x.a, x.team, agents.CreateInput{Profile: profile, Config: cfg})
			if err != nil {
				return failed(KindAgent, f.Slug, err)
			}
			x.remember(KindAgent, f.Slug, ag.ID)
			continue
		}
		obj, _, _ := x.r.object(KindAgent, f.Slug)
		if _, err := x.s.Agents.UpdateTx(ctx, x.q, x.tx, x.a, x.team, obj.ID, agents.UpdateInput{Profile: profile, Config: cfg}, obj.Revision); err != nil {
			return failed(KindAgent, f.Slug, err)
		}
	}
	return nil
}

// agentConfig is a file's draft as the agent configuration the domain stores: its settings, the model and knowledge
// bases resolved to this install's IDs, and no tools (an agent with tools is not carried by a file).
func (x *executor) agentConfig(c AgentConfig) (json.RawMessage, error) {
	m := map[string]any{}
	dec := json.NewDecoder(strings.NewReader(string(c.Settings)))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		return nil, apperr.Invalid("invalid_configuration", "The agent's settings cannot be read")
	}
	if c.Model != nil {
		m["chatModelId"] = x.r.models[*c.Model].ID
	}
	refs := []map[string]any{}
	for _, k := range c.KnowledgeBases {
		ref := map[string]any{"kbId": x.id(KindKnowledgeBase, k.Name)}
		if k.TopK != nil {
			ref["topK"] = *k.TopK
		}
		refs = append(refs, ref)
	}
	m["kbs"] = refs
	m["tools"] = []string{}
	return json.Marshal(m)
}

func (x *executor) evaluations(ctx context.Context) error {
	for _, f := range x.r.file.EvaluationSets {
		row := x.row(KindEvaluationSet, f.Name)
		var setID uuid.UUID
		var current []EvaluationCase
		switch row.Action {
		case ActionCreate:
			in := evals.SetInput{Name: f.Name, Description: f.Description, AutoRun: f.AutoRun}
			if f.KnowledgeBase != "" {
				id := x.id(KindKnowledgeBase, f.KnowledgeBase)
				in.KBID = &id
			} else {
				id := x.id(KindAgent, f.Agent)
				in.AgentID = &id
			}
			set, err := x.s.Evals.CreateTx(ctx, x.q, x.tx, x.a, x.team, in)
			if err != nil {
				return failed(KindEvaluationSet, f.Name, err)
			}
			setID = set.ID
		case ActionUpdate:
			obj, _, _ := x.r.object(KindEvaluationSet, f.Name)
			setID = obj.ID
			name, desc, auto := f.Name, f.Description, f.AutoRun
			if err := x.s.Evals.UpdateTx(ctx, x.q, x.tx, x.a, x.team, setID, evals.SetUpdate{Name: &name, Description: &desc, AutoRun: &auto}, obj.Revision); err != nil {
				return failed(KindEvaluationSet, f.Name, err)
			}
			if cur := find(x.r.current.EvaluationSets, func(s EvaluationSet) string { return s.Name }, f.Name); cur != nil {
				current = cur.Cases
			}
		default:
			continue
		}
		if err := x.questions(ctx, setID, f, current); err != nil {
			return failed(KindEvaluationSet, f.Name, err)
		}
	}
	return nil
}

// questions adds the file's new questions and updates the ones whose expectations changed, matched by their text.
func (x *executor) questions(ctx context.Context, setID uuid.UUID, f EvaluationSet, current []EvaluationCase) error {
	stored, err := x.q.ConfigurationEvalCases(ctx, setID)
	if err != nil {
		return err
	}
	ids := map[string]dbgen.ConfigurationEvalCasesRow{}
	for _, c := range stored {
		ids[c.Question] = c
	}
	was := map[string]EvaluationCase{}
	for _, c := range current {
		was[c.Question] = c
	}
	for _, c := range f.Cases {
		in := evals.CaseInput{Question: c.Question, Expected: evals.Expected{URLs: c.URLs}, MustMention: c.MustMention, Note: c.Note}
		row, ok := ids[c.Question]
		switch {
		case !ok:
			if err := x.s.Evals.CreateQuestionTx(ctx, x.q, x.tx, x.a, x.team, setID, in); err != nil {
				return err
			}
		case string(mustJSON(was[c.Question])) != string(mustJSON(c)):
			if err := x.s.Evals.UpdateQuestionTx(ctx, x.q, x.tx, x.a, x.team, setID, row.ID, in, row.Revision); err != nil {
				return err
			}
		}
	}
	return nil
}

func (x *executor) webhooks(ctx context.Context) ([]WebhookSecret, error) {
	secrets := []WebhookSecret{}
	for _, f := range x.r.file.Webhooks {
		row := x.row(KindWebhook, f.URL)
		switch row.Action {
		case ActionCreate:
			made, err := x.s.Webhooks.CreateTx(ctx, x.q, x.tx, x.a, x.team, webhooks.Input{URL: f.URL, Description: f.Description, Events: f.Events})
			if err != nil {
				return nil, failed(KindWebhook, f.URL, err)
			}
			secrets = append(secrets, WebhookSecret{URL: f.URL, Secret: made.Secret})
		case ActionUpdate:
			obj, _, _ := x.r.object(KindWebhook, f.URL)
			enabled := false
			for _, w := range x.r.current.Webhooks {
				if w.URL == f.URL {
					enabled = w.Enabled // a file never turns a webhook on or off (§5)
				}
			}
			if _, err := x.s.Webhooks.UpdateTx(ctx, x.q, x.tx, x.a, x.team, obj.ID, webhooks.Input{URL: f.URL, Description: f.Description, Events: f.Events, Enabled: enabled}, obj.Revision); err != nil {
				return nil, failed(KindWebhook, f.URL, err)
			}
		}
	}
	return secrets, nil
}
