package httpapi_test

import (
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// fakeContextPrices approves only synthetic fixture accounting. It makes no
// model request and supplies prices explicitly rather than treating unknown as zero.
func (env *ctxEnv) fakeContextPrices(t *testing.T, model apitypes.Model) {
	t.Helper()
	path := "/v1/admin/models/" + model.Id.String() + "/prices"
	var pricing apitypes.ModelPricing
	if code := env.admin.get(path, &pricing); code != 200 {
		t.Fatalf("get fake context prices: %d", code)
	}
	known := map[string]bool{}
	for _, p := range pricing.Current {
		known[string(p.Unit)] = p.Price != nil
	}
	var missing []any
	for _, unit := range []string{"chat_tokens_in", "chat_tokens_out"} {
		if !known[unit] {
			missing = append(missing, map[string]any{"unit": unit, "price": "1.000000"})
		}
	}
	if len(missing) == 0 {
		return
	}
	code, e := env.admin.call("POST", path, map[string]any{"effectiveFrom": time.Now().UTC().Format(time.DateOnly), "prices": missing}, &pricing, nil)
	mustCode(t, "explicit fake context prices", code, e, 201, "")
}
