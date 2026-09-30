// Command grounded runs Grounded, an open-source, multi-tenant RAG and agents
// platform.
//
//	grounded serve     API, embedded UI and background worker in one process (development)
//	grounded api       API and embedded UI
//	grounded worker    background jobs (plus health/metrics listener)
//	grounded migrate   apply database migrations and exit
//	grounded parse F   print the Markdown the built-in parser extracts from file F
//	grounded doctor    check the configuration and every dependency
//	grounded rotate-keys  re-encrypt stored secrets under a new ENCRYPTION_KEY (docs/operations/rotate-keys.md)
//	grounded demo      seed a sample install over the Go documentation (docs/demo.md)
//	grounded version   print the version
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ncecere/grounded/internal/app"
	"github.com/ncecere/grounded/internal/buildinfo"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/parse"
)

const usage = `usage: grounded <command>

commands:
  serve     API, UI and worker in one process (local development)
  api       API and UI
  worker    background jobs
  migrate   apply database migrations and exit
  parse F   print the Markdown extracted from file F (debugging)
  doctor    check the configuration and every dependency (--json, --help)
  rotate-keys [--dry-run] [--pepper-only]
            re-encrypt stored secrets under a new ENCRYPTION_KEY and report
            keys on a previous API_KEY_PEPPER (docs/operations/rotate-keys.md)
  demo      seed a sample install: a Demo team, the Go documentation and two
            agents (--models=fake needs no keys; --help; docs/demo.md)
  version   print the version

Configuration comes from environment variables and the optional YAML file
named by GROUNDED_CONFIG_FILE. See .env.example.
`

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "grounded:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	cmd := app.ModeServe
	if len(args) > 0 {
		cmd = args[0]
	}
	switch cmd {
	case "version", "--version":
		fmt.Println(buildinfo.String())
		return nil
	case "help", "-h", "--help":
		fmt.Print(usage)
		return nil
	case "parse":
		if len(args) != 2 {
			return fmt.Errorf("usage: grounded parse FILE")
		}
		return parseFile(args[1])
	case "doctor":
		return runDoctor(args[1:], os.Stdout)
	case "rotate-keys":
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return rotateKeys(ctx, args[1:], os.Stdout)
	case "demo":
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return runDemo(ctx, args[1:], os.Stdout)
	case app.ModeServe, app.ModeAPI, app.ModeWorker, app.ModeMigrate:
	default:
		fmt.Fprint(os.Stderr, usage)
		return fmt.Errorf("unknown command %q", cmd)
	}

	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("configuration:\n%w", err)
	}
	log := observability.NewLogger(os.Stdout, cfg.LogLevel, cfg.LogFormat)
	// Packages that log through slog's package functions (httpx.Internal)
	// write in the same structured format as everything else.
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return app.Run(ctx, cmd, cfg, log)
}

// parseFile prints what the built-in parser extracts, so operators can see
// how a document will be chunked without uploading it.
func parseFile(name string) error {
	data, err := os.ReadFile(name)
	if err != nil {
		return err
	}
	kind, err := parse.Detect(name, data)
	if err != nil {
		return err
	}
	p := parse.NewBuiltin(parse.Limits{}, 1)
	defer p.Close()
	start := time.Now()
	doc, err := p.Parse(context.Background(), parse.Input{Name: name, Kind: kind, Data: data})
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "kind=%s parser=%s title=%q pages=%d bytes=%d took=%s\n", kind, doc.Parser, doc.Title, doc.Pages, len(doc.Markdown), time.Since(start).Round(time.Millisecond))
	for _, w := range doc.Warnings {
		fmt.Fprintln(os.Stderr, "warning:", w)
	}
	fmt.Print(doc.Markdown)
	return nil
}
