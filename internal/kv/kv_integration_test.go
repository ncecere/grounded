package kv_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/testutil"
)

func TestErrorsAreCounted(t *testing.T) {
	s := testutil.NewKV(t)
	ctx := context.Background()
	if err := s.Client.Get(ctx, s.Key("missing")).Err(); err == nil {
		t.Fatal("GET of a missing key returned no redis.Nil")
	}
	if err := s.Client.Do(ctx, "GROUNDEDNOSUCHCOMMAND").Err(); err == nil {
		t.Fatal("unknown command succeeded")
	}
	pipe := s.Client.Pipeline()
	pipe.Do(ctx, "GROUNDEDNOSUCHPIPED")
	_, _ = pipe.Exec(ctx)

	rec := httptest.NewRecorder()
	observability.NewMetrics().Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body := rec.Body.String()
	for _, want := range []string{
		`grounded_valkey_errors_total{command="groundednosuchcommand"} 1`,
		`grounded_valkey_errors_total{command="groundednosuchpiped"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics lack %s", want)
		}
	}
	if strings.Contains(body, `grounded_valkey_errors_total{command="get"}`) {
		t.Error("a missing key counted as an error")
	}
}
