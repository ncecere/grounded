package httpapi

import (
	"context"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
)

func TestEveryAPIOperationDocumentsSharedRateLimits(t *testing.T) {
	doc, err := openapi3.NewLoader().LoadFromFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		t.Fatal(err)
	}
	count := 0
	for path, item := range doc.Paths.Map() {
		if !strings.HasPrefix(path, "/v1/") {
			continue
		}
		ref := "#/components/responses/DefaultErrorReply"
		if path == "/v1/models" || path == "/v1/chat/completions" {
			ref = "#/components/responses/OpenAIDefaultErrorReply"
		}
		for method, operation := range item.Operations() {
			response := operation.Responses.Value("default")
			if response == nil || response.Ref != ref || response.Value == nil || response.Value.Headers["Retry-After"] == nil {
				t.Errorf("%s %s is missing its envelope-appropriate shared default/Retry-After", method, path)
			}
			count++
		}
	}
	if count < 300 {
		t.Fatalf("unexpected operation coverage: %d", count)
	}
}
