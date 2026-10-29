package agents

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/apperr"
)

func TestConfigTypeErrorsNameFieldsNotGoTypes(t *testing.T) {
	for _, tc := range []struct {
		raw, field, want string
	}{
		{`{"maxOutputTokens":"x"}`, "maxOutputTokens", "maxOutputTokens must be a whole number"},
		{`{"maxOutputTokens":1.5}`, "maxOutputTokens", "maxOutputTokens must be a whole number"},
		{`{"temperature":"warm"}`, "temperature", "temperature must be a number"},
		{`{"queryRewrite":"yes"}`, "queryRewrite", "queryRewrite must be true or false"},
		{`{"kbs":{}}`, "kbs", "kbs must be a list"},
		{`[]`, "config", "config must be an object"},
		{`{"moderation":[]}`, "moderation", "moderation must be an object"},
	} {
		t.Run(tc.field+tc.raw, func(t *testing.T) {
			_, err := ParseConfig(json.RawMessage(tc.raw))
			var problem *apperr.Error
			if !errors.As(err, &problem) || problem.Status != 400 || problem.Code != "invalid_config" {
				t.Fatalf("bad config = %v", err)
			}
			items := problem.Details.(map[string]any)["problems"].([]Problem)
			if len(items) != 1 || items[0].Field != tc.field || !strings.Contains(items[0].Problem, tc.want) {
				t.Errorf("problems = %+v, want %s: %s", items, tc.field, tc.want)
			}
			for _, internal := range []string{"configInput", "Go struct", "of type int", "cannot unmarshal"} {
				if strings.Contains(problem.Message, internal) {
					t.Errorf("internal type leaked: %s", problem.Message)
				}
			}
		})
	}
	if _, err := ParseConfig(json.RawMessage(`{"maxOutputTokens":64,"temperature":0.2,"kbs":[]}`)); err != nil {
		t.Fatalf("valid incomplete draft rejected: %v", err)
	}
}

// #132: a number that is positive but too large was told "must be a positive number".
func TestMaxOutputTokensMessages(t *testing.T) {
	for _, tc := range []struct{ raw, want string }{
		{`{"maxOutputTokens":0}`, "Maximum output tokens must be a positive number"},
		{`{"maxOutputTokens":-5}`, "Maximum output tokens must be a positive number"},
		{`{"maxOutputTokens":99999999999}`, "Maximum output tokens is too large. The most is 1000000"},
		{`{"maxOutputTokens":1000001}`, "Maximum output tokens is too large. The most is 1000000"},
	} {
		_, err := ParseConfig(json.RawMessage(tc.raw))
		var problem *apperr.Error
		if !errors.As(err, &problem) {
			t.Fatalf("%s: %v", tc.raw, err)
		}
		items := problem.Details.(map[string]any)["problems"].([]Problem)
		if len(items) != 1 || items[0].Field != "maxOutputTokens" || items[0].Problem != tc.want {
			t.Errorf("%s: problems = %+v, want %q", tc.raw, items, tc.want)
		}
	}
	if _, err := ParseConfig(json.RawMessage(`{"maxOutputTokens":1000000}`)); err != nil {
		t.Errorf("the limit itself: %v", err)
	}
}
