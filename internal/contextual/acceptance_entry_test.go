package contextual

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"os"
	"strings"
	"testing"
	"time"
)

var acceptanceGrantFile = flag.String("issue21-grant", "", "explicit private single-use issue21 grant; no default live work")

type acceptanceEntryDeps struct {
	root         string
	source       func(context.Context) (string, error)
	testLoopback bool
}

type acceptancePrivateReport struct {
	SourceSHA           string           `json:"sourceSHA"`
	FailureCode         string           `json:"failureCode"`
	OuterCleanup        string           `json:"outerCleanup"`
	EnvelopeReservation string           `json:"permanentEnvelopeReservationUSDNotInvoice"`
	Report              acceptanceReport `json:"harness"`
}

// executeAcceptanceEntry is also exercised with loopback fake controls. The
// exported test has no environment switch for bypassing HTTPS/source/state.
func executeAcceptanceEntry(t *testing.T, path string, deps acceptanceEntryDeps) error {
	t.Helper()
	ctx := t.Context()
	g, err := loadAcceptanceGrant(path)
	if err != nil {
		return err
	}
	if err = validateAcceptanceGrant(ctx, g, deps.source, time.Now(), deps.testLoopback); err != nil {
		return err
	}
	generator := &Generator{Counter: counter(t)}
	if _, err = acceptancePreflight(g.Config, generator); err != nil {
		return errors.New("preflight_bounds")
	}
	// Validate existence/mode without reading credential bytes before the claim.
	keyHandle, err := acceptanceOpenPrivate(g.KeyFile, false)
	if err != nil {
		return errors.New("key_private_file")
	}
	keyHandle.Close()
	if os.Getenv("GROUNDED_TEST_DATABASE_URL") == "" {
		return errors.New("fixture_required")
	}
	if err = claimAcceptance(deps.root, g); err != nil {
		return err
	}
	evidence := acceptancePrivateReport{SourceSHA: g.SourceSHA, OuterCleanup: "pending_outer_receipt", EnvelopeReservation: g.Config.Limits.Amount,
		Report: acceptanceReport{Mode: "real", CorpusSHA256: g.CorpusSHA256, Status: "failed", FailedStage: "entry", ExplicitLimits: g.Config.Limits, Currency: g.Config.Currency, Dimensions: g.Config.Dimensions}}
	if deps.testLoopback {
		evidence.Report.Mode = "fake"
	}
	secret := ""
	// No provider errors, paths or grant JSON are copied into evidence.
	defer func() {
		data, e := json.Marshal(evidence)
		if e == nil {
			// Redact JSON-escaped as well as raw canaries, including synthetic prefixes.
			if secret != "" {
				encoded, _ := json.Marshal(secret)
				data = []byte(strings.ReplaceAll(string(data), string(encoded[1:len(encoded)-1]), "[REDACTED]"))
			}
			e = acceptanceWritePrivate(g.ReportFile, data)
		}
		if e != nil {
			t.Error("private_report_write")
		}
	}()
	key, err := acceptanceReadPrivate(g.KeyFile, 4096)
	if err != nil {
		evidence.FailureCode = "key_read"
		return errors.New("key_read")
	}
	secret = strings.TrimSpace(string(key))
	if secret == "" || strings.ContainsAny(secret, "\r\n\x00") {
		evidence.FailureCode = "key_format"
		return errors.New("key_format")
	}
	run, err := newAcceptanceRun(t, g.Config, secret, evidence.Report.Mode)
	if err != nil {
		evidence.FailureCode = "fixture_setup"
		return errors.New("fixture_setup")
	}
	deadline := time.Now().Add(time.Duration(g.Config.Seconds) * time.Second)
	if g.Expires.Before(deadline) {
		deadline = g.Expires
	}
	runCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	run.guard.check = func() error { return acceptanceDispatchCheck(runCtx, g, deps.source, time.Now()) }

	evidence.Report, err = run.execute(runCtx)
	if err != nil {
		evidence.FailureCode = "harness_failed"
		return errors.New("harness_failed")
	}
	return nil
}

func TestIssue21LiveAcceptance(t *testing.T) {
	if *acceptanceGrantFile == "" {
		t.Skip("explicit -issue21-grant required; no live authority by default")
	}
	if err := executeAcceptanceEntry(t, *acceptanceGrantFile, acceptanceEntryDeps{root: acceptanceStateRoot, source: acceptanceSource}); err != nil {
		t.Fatal(err) // Only fixed local codes, never provider bodies or private paths.
	}
}

func acceptanceDispatchCheck(ctx context.Context, g acceptanceGrant, source func(context.Context) (string, error), now time.Time) error {
	if ctx.Err() != nil || !now.Before(g.Expires) {
		return errors.New("dispatch_expired_or_cancelled")
	}
	sha, err := source(ctx)
	if err != nil || sha != g.SourceSHA {
		return errors.New("dispatch_source")
	}
	return nil
}
