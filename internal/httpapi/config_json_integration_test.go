package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

func TestAgentConfigTypeErrorsUsePublicFieldProblems(t *testing.T) {
	env := newAgentEnv(t)
	var agent apitypes.Agent
	status, e := env.owner.call("POST", env.base+"/agents", map[string]any{"name": "Type helper"}, &agent, nil)
	mustCode(t, "valid incomplete draft", status, e, 201, "")
	for _, method := range []string{"POST", "PATCH"} {
		path := env.base + "/agents"
		body := map[string]any{"name": "Rejected helper", "config": map[string]any{"maxOutputTokens": "x"}}
		var headers map[string]string
		if method == "PATCH" {
			path += "/" + agent.Id.String()
			headers = ifMatch(agent.Revision)
		}
		code, raw := env.owner.raw(method, path, body, headers)
		var response struct {
			Error struct {
				Code, Message string
				Details       struct {
					Problems []struct{ Field, Problem string }
				}
			}
		}
		if code != 400 || json.Unmarshal(raw, &response) != nil || response.Error.Code != "invalid_config" ||
			!strings.Contains(response.Error.Message, "maxOutputTokens must be a whole number") ||
			strings.Contains(response.Error.Message, "Go struct") || strings.Contains(response.Error.Message, "configInput") {
			t.Fatalf("%s = %d %s", method, code, raw)
		}
		problems := response.Error.Details.Problems
		if len(problems) != 1 || problems[0].Field != "maxOutputTokens" {
			t.Fatalf("%s field problems = %+v", method, problems)
		}
	}
	var after apitypes.Agent
	env.owner.get(env.base+"/agents/"+agent.Id.String(), &after)
	if after.Revision != agent.Revision {
		t.Error("invalid config update changed the revision")
	}
}
