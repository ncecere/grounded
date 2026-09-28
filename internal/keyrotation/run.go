package keyrotation

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// DefaultBatchSize is how many values one transaction re-encrypts.
const DefaultBatchSize = 100

// ErrNoPreviousKey: re-encryption needs ENCRYPTION_KEY_PREVIOUS set to the
// old key, different from ENCRYPTION_KEY.
var ErrNoPreviousKey = errors.New("ENCRYPTION_KEY_PREVIOUS must be set to the old key (and differ from ENCRYPTION_KEY)")

// Options control a run.
type Options struct {
	// DryRun checks and counts; nothing is written, not even the audit log.
	DryRun bool
	// PepperOnly skips re-encryption (no ENCRYPTION_KEY_PREVIOUS needed)
	// and only handles the API key pepper.
	PepperOnly bool
	BatchSize  int
	Out        io.Writer // progress (default io.Discard)
}

// Summary is what a run found and did.
type Summary struct {
	Columns []ColumnStats
	// LabelledAPIKeys and LabelledPublishableKeys are digests from before
	// pepper ids now recorded as on the previous pepper.
	LabelledAPIKeys, LabelledPublishableKeys int64
	// PepperKeys are usable keys not on the current pepper, after the run.
	PepperKeys []PepperKey
}

// Reencrypted is the number of values moved to the current key.
func (s Summary) Reencrypted() int {
	n := 0
	for _, c := range s.Columns {
		n += c.Reencrypted
	}
	return n
}

// Run rotates keys: it checks every encrypted value, re-encrypts those on
// the previous key (unless DryRun or PepperOnly), labels legacy key digests
// and reports keys still on a previous pepper. It refuses to write anything
// if a value decrypts with neither key.
func Run(ctx context.Context, pool *pgxpool.Pool, box *secrets.Box, peppers secrets.Peppers, o Options) (Summary, error) {
	if o.BatchSize <= 0 {
		o.BatchSize = DefaultBatchSize
	}
	if o.Out == nil {
		o.Out = io.Discard
	}
	var sum Summary
	if !o.PepperOnly {
		if !box.HasPrevious() {
			return sum, ErrNoPreviousKey
		}
		var err error
		if sum.Columns, err = rotateSecrets(ctx, pool, box, o); err != nil {
			return sum, err
		}
	}
	if err := rotatePepper(ctx, pool, peppers, o, &sum); err != nil {
		return sum, err
	}
	if o.DryRun {
		fmt.Fprintln(o.Out, "\nDry run: nothing was written.")
		return sum, nil
	}
	return sum, recordSummary(ctx, pool, peppers, sum, o.PepperOnly)
}

// rotateSecrets checks every column, then re-encrypts, then checks that no
// value is left on the previous key (a pod still sealing with the old key
// would leave some).
func rotateSecrets(ctx context.Context, pool *pgxpool.Pool, box *secrets.Box, o Options) ([]ColumnStats, error) {
	fmt.Fprintf(o.Out, "Encryption key: current key id %x. Checking %d encrypted column(s)...\n", box.CurrentKeyID()[:4], len(Columns))
	stats := make([]ColumnStats, len(Columns))
	var bad []BadRow
	for i, c := range Columns {
		st, err := scan(ctx, pool, box, c, o.BatchSize)
		if err != nil {
			return nil, err
		}
		stats[i] = st
		bad = append(bad, st.Undecryptable...)
		fmt.Fprintf(o.Out, "  %s: %d stored, %d on the current key, %d on the previous key, %d undecryptable\n",
			st.Column, st.Total, st.Current, st.Previous, len(st.Undecryptable))
	}
	if len(bad) > 0 {
		return stats, &UndecryptableError{Rows: bad}
	}
	if o.DryRun {
		return stats, nil
	}
	fmt.Fprintln(o.Out, "Re-encrypting with the current key...")
	for i, c := range Columns {
		todo := stats[i].Previous
		n, err := reencrypt(ctx, pool, box, c, o.BatchSize, func(done int) {
			fmt.Fprintf(o.Out, "  %s: %d of %d\n", c.Name(), done, todo)
		})
		stats[i].Reencrypted = n
		if err != nil {
			return stats, err
		}
		if n == 0 {
			fmt.Fprintf(o.Out, "  %s: nothing to do\n", c.Name())
		}
	}
	return stats, verify(ctx, pool, box, o)
}

func verify(ctx context.Context, pool *pgxpool.Pool, box *secrets.Box, o Options) error {
	left := 0
	for _, c := range Columns {
		st, err := scan(ctx, pool, box, c, o.BatchSize)
		if err != nil {
			return err
		}
		left += st.Previous + len(st.Undecryptable)
	}
	if left > 0 {
		return fmt.Errorf("%d value(s) were written with another key during the run: make sure every pod runs with the new ENCRYPTION_KEY, then run again", left)
	}
	fmt.Fprintln(o.Out, "Every stored secret is on the current key. ENCRYPTION_KEY_PREVIOUS can be removed.")
	return nil
}

// rotatePepper labels legacy digests (not in a dry run) and reports keys
// that are not on the current pepper.
func rotatePepper(ctx context.Context, pool *pgxpool.Pool, p secrets.Peppers, o Options, sum *Summary) error {
	if len(p.Current) == 0 {
		fmt.Fprintln(o.Out, "\nAPI key pepper: API_KEY_PEPPER is not set; nothing to report.")
		return nil
	}
	if !o.DryRun {
		var err error
		if sum.LabelledAPIKeys, sum.LabelledPublishableKeys, err = labelLegacy(ctx, pool, p); err != nil {
			return fmt.Errorf("label key digests: %w (has `grounded migrate` run?)", err)
		}
	}
	keys, err := PepperReport(ctx, dbgen.New(pool), p)
	if err != nil {
		return fmt.Errorf("pepper report: %w (has `grounded migrate` run?)", err)
	}
	sum.PepperKeys = keys
	printPepper(o.Out, p, *sum)
	return nil
}

func recordSummary(ctx context.Context, pool *pgxpool.Pool, p secrets.Peppers, sum Summary, pepperOnly bool) error {
	cols := map[string]any{}
	for _, c := range sum.Columns {
		cols[c.Column] = map[string]int{"reencrypted": c.Reencrypted, "alreadyCurrent": c.Current}
	}
	counts := map[secrets.PepperState]map[string]int{secrets.PepperPrevious: {}, secrets.PepperRetired: {}}
	for _, k := range sum.PepperKeys {
		counts[k.State][k.Kind]++
	}
	meta := map[string]any{
		"pepperOnly": pepperOnly, "columns": cols,
		"pepper": map[string]any{
			"previousConfigured": len(p.Previous) > 0,
			"labelledApiKeys":    sum.LabelledAPIKeys, "labelledPublishableKeys": sum.LabelledPublishableKeys,
			"onPreviousPepper": counts[secrets.PepperPrevious], "onRetiredPepper": counts[secrets.PepperRetired],
		},
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		return audit.Record(ctx, dbgen.New(tx), audit.Entry{
			ActorKind: audit.ActorSystem, Action: "platform.key_rotation", TargetType: "platform_keys", TargetID: "keys", Metadata: meta,
		})
	})
}
