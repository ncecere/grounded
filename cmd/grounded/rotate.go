package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"

	"github.com/ncecere/grounded/internal/app"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/keyrotation"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store"
)

const rotateUsage = `usage: grounded rotate-keys [--dry-run] [--pepper-only] [--batch-size N]

Re-encrypts every stored secret from ENCRYPTION_KEY_PREVIOUS to ENCRYPTION_KEY
and reports API keys and widget keys still on API_KEY_PEPPER_PREVIOUS (they
are re-hashed when next used). Safe to run while Grounded serves, and safe to
run again after an interruption. See docs/operations/rotate-keys.md.

flags:
`

// rotateKeys runs `grounded rotate-keys` (docs/operations/rotate-keys.md).
func rotateKeys(ctx context.Context, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("rotate-keys", flag.ContinueOnError)
	var help bytes.Buffer
	fs.SetOutput(&help)
	dryRun := fs.Bool("dry-run", false, "check and count only; write nothing")
	pepperOnly := fs.Bool("pepper-only", false, "skip re-encryption (no ENCRYPTION_KEY_PREVIOUS needed); only handle the API key pepper")
	batch := fs.Int("batch-size", keyrotation.DefaultBatchSize, "values re-encrypted per transaction")
	fs.Usage = func() { fmt.Fprint(&help, rotateUsage); fs.PrintDefaults() }
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			_, _ = out.Write(help.Bytes())
			return nil
		}
		return fmt.Errorf("%w\n%s", err, help.String())
	}
	if fs.NArg() > 0 || *batch < 1 {
		fs.Usage()
		return fmt.Errorf("invalid arguments\n%s", help.String())
	}

	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("configuration:\n%w", err)
	}
	if err := checkRotateConfig(cfg, *pepperOnly); err != nil {
		return err
	}
	box, err := app.NewSecretBox(cfg)
	if err != nil {
		return err
	}
	peppers, err := app.NewPeppers(cfg)
	if err != nil {
		return err
	}
	pool, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	sum, err := keyrotation.Run(ctx, pool, box, peppers, keyrotation.Options{DryRun: *dryRun, PepperOnly: *pepperOnly, BatchSize: *batch, Out: out})
	if err != nil {
		return err
	}
	if !*dryRun && !*pepperOnly {
		fmt.Fprintf(out, "\nDone: %d secret(s) re-encrypted.\n", sum.Reencrypted())
	}
	return nil
}

// checkRotateConfig refuses a run that could not do what it is asked:
// re-encryption needs a previous key different from the current one.
func checkRotateConfig(cfg config.Config, pepperOnly bool) error {
	if err := cfg.Validate("migrate"); err != nil { // DATABASE_URL
		return fmt.Errorf("invalid configuration:\n%w", err)
	}
	cur, err := secrets.ParseKey(cfg.EncryptionKey)
	if err != nil {
		return fmt.Errorf("ENCRYPTION_KEY: %w", err)
	}
	if pepperOnly {
		return nil
	}
	if cfg.EncryptionKeyPrevious == "" {
		return errors.New("ENCRYPTION_KEY_PREVIOUS is not set: set it to the old key and ENCRYPTION_KEY to the new one " +
			"(to handle only the API key pepper, use --pepper-only)")
	}
	prev, err := secrets.ParseKey(cfg.EncryptionKeyPrevious)
	if err != nil {
		return fmt.Errorf("ENCRYPTION_KEY_PREVIOUS: %w", err)
	}
	if bytes.Equal(prev, cur) {
		return errors.New("ENCRYPTION_KEY_PREVIOUS equals ENCRYPTION_KEY: set ENCRYPTION_KEY to a new key (openssl rand -base64 32)")
	}
	return nil
}
