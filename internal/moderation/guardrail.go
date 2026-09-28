// Guardrail models served as chat models (ADR-0019 kind guardrail_chat).
// Each family has its own conversation format and output; the server's chat
// template builds the family's prompt from the messages (and, where the
// model card says so, chat_template_kwargs). Probabilities come from the
// log-probabilities of the label token when the server returns them;
// otherwise the label gives 0 or 1 and the result is not calibrated.

package moderation

import (
	"context"
	"regexp"
	"strings"
	"sync"

	"github.com/ncecere/grounded/internal/catalog"
)

// ---- Llama Guard 3 / 4 -------------------------------------------------------------

// llamaGuard sends the conversation; the model's chat template adds the
// MLCommons hazard categories S1-S14. It answers "safe", or "unsafe" and a
// second line of violated codes such as "S1,S10".
type llamaGuard struct{ chat chatCaller }

// llamaGuardCodes maps hazard codes to our categories. S6 (specialized
// advice), S8 (intellectual property), S13 (elections) and S14 (code
// interpreter abuse) have no equivalent; prompt_injection is unsupported.
var llamaGuardCodes = map[string]string{
	"S1": Violence, "S2": Illicit, "S3": Sexual, "S4": SexualMinors, "S5": HarassmentHate,
	"S7": PersonalData, "S9": Violence, "S10": HarassmentHate, "S11": SelfHarm, "S12": Sexual,
}

func (p *llamaGuard) Check(ctx context.Context, in Input) (Result, error) {
	reply, err := p.chat.complete(ctx, conversation(in), 20, nil)
	if err != nil {
		return Result{}, err
	}
	return parseLlamaGuard(reply)
}

// parseLlamaGuard reads "safe" or "unsafe\nS1,S10". With log-probabilities,
// P(unsafe) is the score of every listed category (and the ceiling of the
// others when the verdict is safe).
func parseLlamaGuard(reply chatReply) (Result, error) {
	lines := strings.Split(strings.TrimSpace(reply.Text), "\n")
	verdict := strings.ToLower(strings.TrimSpace(lines[0]))
	if verdict != "safe" && verdict != "unsafe" {
		return Result{}, badResponse("Llama Guard answered %q instead of safe or unsafe", truncate(verdict, 40))
	}
	pUnsafe, calibrated := labelProbability(reply.Tokens, "unsafe", "safe")
	if !calibrated {
		pUnsafe = 0
		if verdict == "unsafe" {
			pUnsafe = 1
		}
	}
	out := newResult(catalog.ModerationGuardrail+"/"+catalog.FamilyLlamaGuard, calibrated)
	listed := map[string]bool{}
	if verdict == "unsafe" && len(lines) > 1 {
		for _, code := range strings.Split(lines[1], ",") {
			if c, ok := llamaGuardCodes[strings.ToUpper(strings.TrimSpace(code))]; ok {
				listed[c] = true
			}
		}
	}
	for _, c := range llamaGuardCodes {
		switch {
		case listed[c]:
			out.set(c, pUnsafe)
		case verdict == "safe":
			out.set(c, pUnsafe)
		default:
			out.set(c, 0)
		}
	}
	return out, nil
}

// ---- Granite Guardian 3.x ------------------------------------------------------------

// graniteGuardian judges one risk per request, chosen with guardian_config
// in chat_template_kwargs: a built-in criterion or a custom one. 3.3 answers
// "<score> yes </score>"; 3.1 and 3.2 answer "Yes" or "No". Both keys of the
// config are sent (criteria_id/custom_criteria for 3.3, risk_name/
// risk_definition for earlier versions).
type graniteGuardian struct{ chat chatCaller }

// graniteBuiltIn are Granite Guardian's pre-baked criteria; the other
// categories use our definitions as custom criteria.
var graniteBuiltIn = map[string]string{
	Violence: "violence", Sexual: "sexual_content", Illicit: "unethical_behavior", PromptInjection: "jailbreak",
}

func graniteConfig(category string) map[string]any {
	if id, ok := graniteBuiltIn[category]; ok {
		return map[string]any{"criteria_id": id, "risk_name": id}
	}
	def := defs.Categories[category].Definition
	return map[string]any{"custom_criteria": def, "risk_name": category, "risk_definition": def}
}

var graniteScore = regexp.MustCompile(`(?is)<score>\s*(yes|no)\s*</score>`)

// parseGranite reads a yes/no verdict; P(yes) from log-probabilities when
// available.
func parseGranite(reply chatReply) (p float64, calibrated bool, err error) {
	text := strings.TrimSpace(reply.Text)
	verdict := ""
	if m := graniteScore.FindAllStringSubmatch(text, -1); len(m) > 0 {
		verdict = strings.ToLower(m[len(m)-1][1])
	} else if f := strings.Fields(strings.ToLower(text)); len(f) > 0 {
		verdict = strings.Trim(f[0], ".,:;!")
	}
	if verdict != "yes" && verdict != "no" {
		return 0, false, badResponse("Granite Guardian answered %q instead of yes or no", truncate(text, 40))
	}
	if p, ok := labelProbability(reply.Tokens, "yes", "no"); ok {
		return p, true, nil
	}
	if verdict == "yes" {
		return 1, false, nil
	}
	return 0, false, nil
}

func (p *graniteGuardian) Check(ctx context.Context, in Input) (Result, error) {
	return judgeEach(ctx, catalog.FamilyGraniteGuardian, Categories, func(ctx context.Context, c string) (float64, bool, error) {
		reply, err := p.chat.complete(ctx, conversation(in), 20, map[string]any{
			"chat_template_kwargs": map[string]any{"guardian_config": graniteConfig(c), "think": false},
		})
		if err != nil {
			return 0, false, err
		}
		return parseGranite(reply)
	})
}

// ---- ShieldGemma -----------------------------------------------------------------------

// shieldGemma judges one policy per request (the model card's guideline,
// passed as chat_template_kwargs.guideline; the prompt-only wording for
// input and the prompt-response wording for output). It answers Yes or No;
// the score is P(Yes) over Yes and No.
type shieldGemma struct{ chat chatCaller }

type shieldPolicy struct {
	name, harm string
	categories []string
}

// shieldPolicies are the model card's four harm types. sexual_minors,
// personal_data and prompt_injection have no policy (unsupported).
var shieldPolicies = []shieldPolicy{
	{"No Dangerous Content", "content that harming oneself and/or others (e.g., accessing or building firearms and explosive devices, promotion of terrorism, instructions for suicide).",
		[]string{Violence, SelfHarm, Illicit}},
	{"No Harassment", "content that is malicious, intimidating, bullying, or abusive content targeting another individual (e.g., physical threats, denial of tragic events, disparaging victims of violence).",
		[]string{HarassmentHate}},
	{"No Hate Speech", "content that targeting identity and/or protected attributes (e.g., racial slurs, promotion of discrimination, calls to violence against protected groups) or dehumanizing/belittling/vilifying on the bases of race, ethnicity, religion, disability, age, nationality, veteran status, sexual orientation, gender, gender identity, caste, or any other protected status. We do allow content that includes a reference to a protected individual or group in a positive manner.",
		[]string{HarassmentHate}},
	{"No Sexually Explicit Information", "content that contains references to sexual acts or other lewd content (e.g., sexually graphic descriptions, content aimed at causing arousal). Medical or scientific terms related to human anatomy or sex education are permitted.",
		[]string{Sexual}},
}

// guideline is the policy text for a stage, as in the model card.
func (sp shieldPolicy) guideline(stage string) string {
	subject := "The prompt shall not contain or seek generation of "
	if stage == StageOutput {
		subject = "The chatbot shall not generate "
	}
	return `"` + sp.name + `": ` + subject + sp.harm
}

// parseShieldGemma reads Yes or No.
func parseShieldGemma(reply chatReply) (float64, bool, error) {
	f := strings.Fields(strings.ToLower(strings.TrimSpace(reply.Text)))
	verdict := ""
	if len(f) > 0 {
		verdict = strings.Trim(f[0], ".,:;!")
	}
	if verdict != "yes" && verdict != "no" {
		return 0, false, badResponse("ShieldGemma answered %q instead of Yes or No", truncate(reply.Text, 40))
	}
	if p, ok := labelProbability(reply.Tokens, "yes", "no"); ok {
		return p, true, nil
	}
	if verdict == "yes" {
		return 1, false, nil
	}
	return 0, false, nil
}

func (p *shieldGemma) Check(ctx context.Context, in Input) (Result, error) {
	var (
		mu         sync.Mutex
		calibrated = true
		out        = newResult(catalog.ModerationGuardrail+"/"+catalog.FamilyShieldGemma, false)
	)
	err := fanOut(ctx, shieldPolicies, func(ctx context.Context, sp shieldPolicy) error {
		reply, err := p.chat.complete(ctx, conversation(in), 3, map[string]any{
			"chat_template_kwargs": map[string]any{"guideline": sp.guideline(in.Stage)},
		})
		if err != nil {
			return err
		}
		prob, cal, err := parseShieldGemma(reply)
		if err != nil {
			return err
		}
		mu.Lock()
		defer mu.Unlock()
		calibrated = calibrated && cal
		for _, c := range sp.categories {
			out.set(c, prob)
		}
		return nil
	})
	out.Calibrated = calibrated
	return out, err
}

// judgeEach asks one yes/no question per category concurrently.
func judgeEach(ctx context.Context, family string, cats []string, ask func(context.Context, string) (float64, bool, error)) (Result, error) {
	var (
		mu         sync.Mutex
		calibrated = true
		out        = newResult(catalog.ModerationGuardrail+"/"+family, false)
	)
	err := fanOut(ctx, cats, func(ctx context.Context, c string) error {
		prob, cal, err := ask(ctx, c)
		if err != nil {
			return err
		}
		mu.Lock()
		defer mu.Unlock()
		calibrated = calibrated && cal
		out.set(c, prob)
		return nil
	})
	out.Calibrated = calibrated
	return out, err
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}
