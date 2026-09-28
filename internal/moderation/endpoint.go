package moderation

import (
	"context"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
)

// moderationsEndpoint is an OpenAI-compatible POST /moderations. Its
// category scores are probabilities, so the result is calibrated.
type moderationsEndpoint struct {
	cl    *gateway.Client
	model string
}

// openAICategories maps the endpoint's categories to ours. personal_data
// and prompt_injection have no equivalent (unsupported).
var openAICategories = map[string][]string{
	"violence":               {Violence},
	"violence/graphic":       {Violence},
	"self-harm":              {SelfHarm},
	"self-harm/intent":       {SelfHarm},
	"self-harm/instructions": {SelfHarm},
	"sexual":                 {Sexual},
	"sexual/minors":          {SexualMinors},
	"harassment":             {HarassmentHate},
	"harassment/threatening": {HarassmentHate},
	"hate":                   {HarassmentHate},
	"hate/threatening":       {HarassmentHate},
	"illicit":                {Illicit},
	"illicit/violent":        {Illicit, Violence},
}

func (p *moderationsEndpoint) Check(ctx context.Context, in Input) (Result, error) {
	var res struct {
		Results []struct {
			Categories     map[string]bool     `json:"categories"`
			CategoryScores map[string]*float64 `json:"category_scores"`
		} `json:"results"`
	}
	if err := p.cl.PostJSON(ctx, "/moderations", map[string]any{"model": p.model, "input": in.Text}, &res); err != nil {
		return Result{}, err
	}
	if len(res.Results) == 0 {
		return Result{}, badResponse("no moderation results returned")
	}
	return parseModerations(res.Results[0].Categories, res.Results[0].CategoryScores)
}

// parseModerations maps one /moderations result. Scores win; a server that
// only returns flags gets 0 or 1 and an uncalibrated result.
func parseModerations(flags map[string]bool, scores map[string]*float64) (Result, error) {
	out := newResult(catalog.ModerationEndpoint, len(scores) > 0)
	seen := false
	for name, targets := range openAICategories {
		var p float64
		if s, ok := scores[name]; ok && s != nil {
			p = *s
		} else if f, ok := flags[name]; ok {
			if f {
				p = 1
			}
		} else {
			continue
		}
		seen = true
		for _, c := range targets {
			out.set(c, p)
		}
	}
	if !seen {
		return Result{}, badResponse("the moderation result has no known categories")
	}
	return out, nil
}
