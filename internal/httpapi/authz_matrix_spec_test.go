package httpapi_test

import (
	"sort"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
)

// specOperations lists every operationId in api/openapi.yaml.
func specOperations(t *testing.T) []string {
	t.Helper()
	doc, err := openapi3.NewLoader().LoadFromFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	var ops []string
	for path, item := range doc.Paths.Map() {
		for method, op := range item.Operations() {
			if op.OperationID == "" {
				t.Errorf("%s %s has no operationId", strings.ToUpper(method), path)
			}
			ops = append(ops, op.OperationID)
		}
	}
	sort.Strings(ops)
	return ops
}

// TestAuthzMatrixClassifiesEveryOperation fails for an operation in the spec
// that the authorization matrix does not classify (it needs no database, so
// `make test-unit` catches a new route too). Classify it in
// authz_matrix_policy_*_test.go: who may call it on their own team or
// objects, and who on another team's.
func TestAuthzMatrixClassifiesEveryOperation(t *testing.T) {
	if missing := unclassified(specOperations(t)); len(missing) > 0 {
		t.Fatalf("classify these operations in matrixPolicies (internal/httpapi/authz_matrix_policy_*_test.go):\n  %s",
			strings.Join(missing, "\n  "))
	}
}
