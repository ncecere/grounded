package doctor

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
)

var symbols = map[Status]string{OK: "✓", Warn: "⚠", Info: "ℹ", Fail: "✗", Skip: "-"}

// WriteJSON writes the report as indented JSON.
func (rep Report) WriteJSON(w io.Writer) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(rep)
}

// WriteText writes the report as a table: status, check, duration, detail,
// with HTTP phases and fixes on indented lines below.
func (rep Report) WriteText(w io.Writer) error {
	var b strings.Builder
	fmt.Fprintf(&b, "grounded doctor (%s; configuration checked for grounded %s)\n\n", rep.Version, rep.Mode)
	nameWidth := 10
	for _, c := range rep.Checks {
		nameWidth = max(nameWidth, min(len(label(c)), 32))
	}
	indent := strings.Repeat(" ", 2+nameWidth+2+8+2)
	counts := map[Status]int{}
	for _, c := range rep.Checks {
		counts[c.Status]++
		fmt.Fprintf(&b, "%s %-*s  %8s  %s\n", symbols[c.Status], nameWidth, truncate(label(c), 32), duration(c.DurationMs), c.Detail)
		if c.Timings != nil {
			fmt.Fprintf(&b, "%s%s\n", indent, phases(*c.Timings))
		}
		if c.Fix != "" && c.Status != OK {
			fmt.Fprintf(&b, "%sfix: %s\n", indent, c.Fix)
		}
	}
	verdict := "all checks passed"
	if !rep.OK {
		verdict = "FAILED"
	}
	fmt.Fprintf(&b, "\n%d checks: %d ok, %d warnings, %d info, %d failed, %d skipped. %s\n",
		len(rep.Checks), counts[OK], counts[Warn], counts[Info], counts[Fail], counts[Skip], verdict)
	_, err := io.WriteString(w, b.String())
	return err
}

func label(c Check) string { return c.Group + " " + c.Name }

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}

func duration(ms float64) string {
	if ms <= 0 {
		return ""
	}
	return gateway.FormatDuration(time.Duration(ms * float64(time.Millisecond)))
}

// phases is the HTTP phase line, e.g. "DNS 4.02s, connect 3ms, TLS 21ms, first byte 612ms".
func phases(t Timings) string {
	d := func(ms float64) time.Duration { return time.Duration(ms * float64(time.Millisecond)) }
	return gateway.Timings{DNS: d(t.DNSMs), Connect: d(t.ConnectMs), TLS: d(t.TLSMs), FirstByte: d(t.FirstByteMs), Reused: t.Reused}.String()
}
