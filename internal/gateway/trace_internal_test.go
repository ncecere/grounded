package gateway

import (
	"testing"
	"time"
)

// A timeout names the phase in progress and the phases that completed.
func TestTimeoutMessagePhases(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name  string
		trace *Trace
		want  string
	}{
		{"dns", &Trace{dnsStart: now, dnsHost: "proxy.example.edu"}, "timed out after 4.4s (DNS lookup of proxy.example.edu)"},
		{"connect after slow dns", &Trace{dnsStart: now, dnsDone: now.Add(4 * time.Second), connStart: now.Add(4 * time.Second)},
			"timed out after 4.4s (connect; DNS 4s)"},
		{"nothing traced", &Trace{}, "timed out after 4.4s"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := timeoutMessage(tc.trace, 4400*time.Millisecond, "ai.example.edu"); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
	if got := FormatDuration(1234 * time.Microsecond); got != "1.2ms" {
		t.Errorf("FormatDuration = %q", got)
	}
}
