package observability_test

import (
	"context"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/ncecere/grounded/internal/observability"
	gtest "github.com/ncecere/grounded/internal/testutil"
)

func TestStateCollector(t *testing.T) {
	pool, _ := gtest.NewDB(t)
	ctx := context.Background()
	for _, sql := range []string{
		`INSERT INTO river_job (args, kind, max_attempts, priority, queue, state, scheduled_at)
		 VALUES ('{}', 'test.waiting', 5, 1, 'default', 'available', now() - interval '90 seconds'),
		        ('{}', 'test.waiting', 5, 1, 'default', 'available', now() - interval '10 seconds')`,
		`INSERT INTO river_job (args, kind, max_attempts, priority, queue, state, scheduled_at, finalized_at)
		 VALUES ('{}', 'test.waiting', 5, 1, 'default', 'discarded', now(), now())`,
		`INSERT INTO river_job (args, kind, max_attempts, priority, queue, state, scheduled_at, attempted_at, attempt)
		 VALUES ('{}', 'test.running', 5, 1, 'default', 'running', now() - interval '2 hours', now() - interval '1 hour', 1)`,
		`UPDATE maintenance_mode SET enabled = true, reason = 'upgrade', started_at = now() - interval '3 hours'`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	c := observability.NewStateCollector(pool, gtest.Logger())
	body := collectText(t, c)
	for _, want := range []string{
		"grounded_state_up 1",
		`grounded_jobs{kind="test.waiting",state="available"} 2`,
		`grounded_jobs{kind="test.waiting",state="discarded"} 1`,
		`grounded_jobs{kind="test.running",state="running"} 1`,
		"grounded_maintenance_mode 1",
		`grounded_breakglass_open_sessions{status="active"} 0`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("state lacks %q:\n%s", want, body)
		}
	}
	age := gaugeValue(t, body, `grounded_jobs_oldest_available_age_seconds{kind="test.waiting"}`)
	if age < 85 || age > 600 {
		t.Errorf("oldest available age = %v, want about 90", age)
	}
	if run := gaugeValue(t, body, `grounded_jobs_oldest_running_age_seconds{kind="test.running"}`); run < 3500 {
		t.Errorf("oldest running age = %v, want about 3600", run)
	}
	started := gaugeValue(t, body, "grounded_maintenance_mode_started_timestamp_seconds")
	if d := time.Since(time.Unix(int64(started), 0)); d < 2*time.Hour || d > 4*time.Hour {
		t.Errorf("maintenance started %v ago, want 3h", d)
	}

	// A failed read reports grounded_state_up 0 and nothing else.
	pool.Close()
	c = observability.NewStateCollector(pool, gtest.Logger())
	if body := collectText(t, c); !strings.Contains(body, "grounded_state_up 0") || strings.Contains(body, "grounded_jobs{") {
		t.Errorf("after a failed read:\n%s", body)
	}
}

func TestPoolCollector(t *testing.T) {
	pool, _ := gtest.NewDB(t)
	body := collectText(t, observability.NewPoolCollector(pool))
	if n := strings.Count(body, "# TYPE grounded_db_pool_"); n != 9 {
		t.Fatalf("pool metrics = %d, want 9:\n%s", n, body)
	}
	if v := gaugeValue(t, body, "grounded_db_pool_max_connections"); v < 1 {
		t.Errorf("max connections = %v", v)
	}
}

// collectText renders a collector's metrics in the text format.
func collectText(t *testing.T, c prometheus.Collector) string {
	t.Helper()
	r := prometheus.NewRegistry()
	r.MustRegister(c)
	rec := httptest.NewRecorder()
	promhttp.HandlerFor(r, promhttp.HandlerOpts{}).ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	return rec.Body.String()
}

// gaugeValue reads one series' value from the text format.
func gaugeValue(t *testing.T, body, series string) float64 {
	t.Helper()
	for _, line := range strings.Split(body, "\n") {
		if v, ok := strings.CutPrefix(line, series+" "); ok {
			f, err := strconv.ParseFloat(v, 64)
			if err != nil {
				t.Fatal(err)
			}
			return f
		}
	}
	t.Fatalf("no series %s in:\n%s", series, body)
	return 0
}
