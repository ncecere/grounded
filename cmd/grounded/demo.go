package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/app"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/demo"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store"
)

const demoUsage = `usage: grounded demo [flags]

Seeds a sample install: a Demo team with a web source over the Go
documentation (https://go.dev/doc/, about 100 pages), a knowledge base and two
published agents, plus what they need (the go.dev crawl allowlist entry, and
model objects when --models is given). It refuses unless the install has no
teams (--force adds the Demo team next to them), never changes existing data,
and is safe to run again. See docs/demo.md.

Models:
  (default)            the install's default embedding profile and first chat model
  --models=fake        the built-in fake gateway: canned answers, no keys needed
  --models=openai-compatible
                       a real gateway: --chat-url, --chat-key, --chat-model,
                       --embed-model (and optionally --embed-url, --embed-key,
                       --embed-dims, --systemone-model)
  --serve-fake-models  seed with --models=fake, then serve the fake gateway on
                       --fake-addr until stopped

Every flag can also be set as an environment variable: DEMO_ and the flag name
in capitals with underscores (DEMO_CHAT_KEY, DEMO_OWNER_EMAIL, ...). Prefer
the variables for keys.

flags:
`

// demoFlags are the parsed `grounded demo` flags.
type demoFlags struct {
	owner, models, siteURL, fakeURL, fakeAddr string
	force, serve                              bool
	wordDelay                                 time.Duration
	m                                         demo.Models
}

func parseDemoFlags(args []string, out io.Writer) (*demoFlags, bool, error) {
	fs := flag.NewFlagSet("demo", flag.ContinueOnError)
	var help bytes.Buffer
	fs.SetOutput(&help)
	f := &demoFlags{}
	str := func(p *string, name, def, usage string) { fs.StringVar(p, name, def, usage) }
	str(&f.owner, "owner-email", "", "owner of the Demo team (default: the bootstrap admin, the development admin with DEV_AUTH, or the only platform admin)")
	str(&f.models, "models", "", "fake or openai-compatible (default: the install's models)")
	str(&f.siteURL, "site-url", demo.DefaultSiteURL, "crawl seed of the documentation source (for tests and offline trials)")
	str(&f.fakeAddr, "fake-addr", "127.0.0.1:8090", "listen address of the fake gateway (--serve-fake-models)")
	str(&f.fakeURL, "fake-url", "", "base URL Grounded uses to reach the fake gateway (default: http://<fake-addr>/v1)")
	str(&f.m.ChatURL, "chat-url", "", "chat gateway base URL, e.g. https://gateway.example.edu/v1")
	str(&f.m.ChatKey, "chat-key", "", "chat gateway API key")
	str(&f.m.ChatModel, "chat-model", "", "chat model ID on the gateway")
	str(&f.m.EmbedURL, "embed-url", "", "embedding gateway base URL (default: --chat-url)")
	str(&f.m.EmbedKey, "embed-key", "", "embedding gateway API key (default: --chat-key)")
	str(&f.m.EmbedModel, "embed-model", "", "embedding model ID on the gateway")
	str(&f.m.SystemOneModel, "systemone-model", "", "optional SystemOne model ID on the chat gateway")
	fs.IntVar(&f.m.EmbedDims, "embed-dims", 0, "embedding dimensions (default: asked from the gateway)")
	fs.BoolVar(&f.force, "force", false, "add the Demo team to an install that already has teams")
	fs.BoolVar(&f.serve, "serve-fake-models", false, "seed with the fake gateway, then serve it until stopped")
	fs.DurationVar(&f.wordDelay, "fake-word-delay", 0, "pause between the words of each fake answer, e.g. 20ms (load tests: simulates a model's generation speed)")
	fs.Usage = func() { fmt.Fprint(&help, demoUsage); fs.PrintDefaults() }
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			_, _ = out.Write(help.Bytes())
			return nil, true, nil
		}
		return nil, false, fmt.Errorf("%w\n%s", err, help.String())
	}
	if fs.NArg() > 0 {
		return nil, false, fmt.Errorf("unexpected argument %q\n%s", fs.Arg(0), help.String())
	}
	if err := flagsFromEnv(fs); err != nil {
		return nil, false, err
	}
	return f, false, f.resolve()
}

// flagsFromEnv sets each flag not given on the command line from its
// DEMO_* variable (--chat-key: DEMO_CHAT_KEY). The variables are not flag
// defaults, so --help never prints a key.
func flagsFromEnv(fs *flag.FlagSet) error {
	given := map[string]bool{}
	fs.Visit(func(f *flag.Flag) { given[f.Name] = true })
	var errs []error
	fs.VisitAll(func(f *flag.Flag) {
		name := "DEMO_" + strings.ToUpper(strings.ReplaceAll(f.Name, "-", "_"))
		if v := os.Getenv(name); v != "" && !given[f.Name] {
			if err := f.Value.Set(v); err != nil {
				errs = append(errs, fmt.Errorf("%s: %w", name, err))
			}
		}
	})
	return errors.Join(errs...)
}

// resolve applies --serve-fake-models and the fake gateway URL default.
func (f *demoFlags) resolve() error {
	if f.serve && f.models == "" {
		f.models = demo.ModelsFake
	}
	if f.serve && f.models != demo.ModelsFake {
		return errors.New("--serve-fake-models only works with --models=fake")
	}
	f.m.Mode = f.models
	if f.m.Mode == demo.ModelsFake {
		f.m.FakeURL = f.fakeURL
		if f.m.FakeURL == "" {
			host, port, err := net.SplitHostPort(f.fakeAddr)
			if err != nil {
				return fmt.Errorf("--fake-addr: %w", err)
			}
			if host == "" || net.ParseIP(host) != nil && net.ParseIP(host).IsUnspecified() {
				host = "127.0.0.1"
			}
			f.m.FakeURL = "http://" + net.JoinHostPort(host, port) + "/v1"
		}
	}
	return f.m.Validate()
}

// runDemo runs `grounded demo` (docs/demo.md).
func runDemo(ctx context.Context, args []string, out io.Writer) error {
	f, done, err := parseDemoFlags(args, out)
	if err != nil || done {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("configuration:\n%w", err)
	}
	if err := cfg.Validate(app.ModeWorker); err != nil {
		return fmt.Errorf("invalid configuration:\n%w", err)
	}
	log := observability.NewLogger(os.Stderr, "warn", cfg.LogFormat)
	var fake *http.Server
	if f.serve {
		// Listen first: the first crawl starts as soon as the source exists,
		// and its pages need embeddings.
		if fake, err = startFakeModels(f.fakeAddr, f.wordDelay, out); err != nil {
			return err
		}
		defer fake.Close()
	}
	res, err := seedDemo(ctx, cfg, f, log)
	if err != nil {
		return err
	}
	printDemo(out, res, f)
	if fake == nil {
		return nil
	}
	fmt.Fprintf(out, "\nServing the fake model gateway on http://%s/v1 until stopped.\n", f.fakeAddr)
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return fake.Shutdown(shutdown)
}

func startFakeModels(addr string, wordDelay time.Duration, out io.Writer) (*http.Server, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("fake model gateway: %w", err)
	}
	srv := &http.Server{Handler: demo.NewPacedFakeModels(demo.FakeAPIKey, wordDelay), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintln(out, "fake model gateway:", err)
		}
	}()
	return srv, nil
}

// seedDemo connects to Postgres and Valkey, wires the services and seeds.
func seedDemo(ctx context.Context, cfg config.Config, f *demoFlags, log *slog.Logger) (demo.Result, error) {
	pool, err := store.OpenWait(ctx, cfg.DatabaseURL, 3*time.Minute, log)
	if err != nil {
		return demo.Result{}, err
	}
	defer pool.Close()
	if cfg.MigrateOnStart {
		if err := store.Migrate(ctx, pool, log); err != nil {
			return demo.Result{}, err
		}
	}
	kvs, err := kv.Open(ctx, cfg.ValkeyURL, cfg.ValkeyPrefix)
	if err != nil {
		return demo.Result{}, err
	}
	defer kvs.Close()
	inserter, err := jobs.NewInsertOnly(pool, log)
	if err != nil {
		return demo.Result{}, fmt.Errorf("job client: %w", err)
	}
	svc, err := app.NewServices(ctx, cfg, pool, inserter, kvs, log)
	if err != nil {
		return demo.Result{}, err
	}
	defer svc.Close()
	return demo.Seed(ctx, pool, svc, demo.Options{
		Owner:   demo.Owner{Email: f.owner, DevAuth: cfg.DevAuth, Issuer: cfg.OIDC.Issuer, BootstrapSubject: cfg.OIDC.BootstrapAdminSubject},
		Force:   f.force,
		SiteURL: f.siteURL,
		Models:  f.m,
		AppURL:  cfg.AppURL,
	})
}

func printDemo(out io.Writer, res demo.Result, f *demoFlags) {
	if res.Skipped {
		fmt.Fprintln(out, `A team with the slug "demo" already exists and was not created by grounded demo: nothing was added.`)
		return
	}
	if len(res.Created) == 0 {
		fmt.Fprintln(out, "The demo is already seeded: nothing to add.")
	} else {
		fmt.Fprintln(out, "Seeded the Grounded demo:")
		for _, c := range res.Created {
			fmt.Fprintln(out, "  -", c)
		}
	}
	fmt.Fprintf(out, "\nAgents (sign in as %s):\n", res.OwnerEmail)
	for _, a := range res.Agents {
		fmt.Fprintf(out, "  %s, for %s:\n    %s\n", a.Name, a.Audience, a.URL)
	}
	fmt.Fprintln(out, "\nNext steps:")
	fmt.Fprintf(out, "  - The worker (grounded serve or grounded worker) crawls %s; answers improve as pages are indexed.\n"+
		"    Progress: Demo team -> Sources -> %s.\n", f.siteURL, "Go documentation")
	if res.FakeModels {
		fmt.Fprintln(out, "  - The agents use the fake model gateway: answers are canned quotes of the best-matching passages, labelled as such.\n"+
			"    For real answers, run grounded demo --models=openai-compatible (docs/demo.md).")
	}
}
