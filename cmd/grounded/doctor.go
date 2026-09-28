package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/doctor"
)

// errChecksFailed makes `grounded doctor` exit non-zero after printing its
// report.
var errChecksFailed = errors.New("some checks failed")

type urlList []string

func (u *urlList) String() string { return strings.Join(*u, ",") }
func (u *urlList) Set(v string) error {
	*u = append(*u, v)
	return nil
}

// runDoctor implements `grounded doctor [flags]` (docs/phase5-deploy.md §5
// E7). It uses the same configuration as the other commands, so in a pod
// (the image has no shell; the binary is /grounded):
// kubectl exec deploy/grounded-api -c api -- /grounded doctor
func runDoctor(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("doctor", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "print the report as JSON")
	mode := fs.String("mode", "api", "process mode whose configuration is validated: api, worker, serve or migrate")
	timeout := fs.Duration("timeout", 10*time.Second, "time limit of each check")
	var probes urlList
	fs.Var(&probes, "probe", "also time a GET to this URL (repeatable), e.g. a model gateway or a site to crawl")
	fs.Usage = func() {
		fmt.Fprint(fs.Output(), "usage: grounded doctor [--json] [--mode api|worker|serve|migrate] [--timeout 10s] [--probe URL]...\n\n"+
			"Checks the configuration (the production safety checks and warnings), then\n"+
			"Postgres, Valkey, object storage, the OIDC issuer and every enabled model\n"+
			"connection. Exits 1 if any check fails.\n\n")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); errors.Is(err, flag.ErrHelp) {
		return nil
	} else if err != nil {
		return err
	}
	switch *mode {
	case "api", "worker", "serve", "migrate":
	default:
		return fmt.Errorf("--mode must be api, worker, serve or migrate")
	}

	var rep doctor.Report
	if cfg, err := config.Load(); err != nil {
		rep = doctor.ConfigLoadFailed(*mode, err)
	} else {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		rep = doctor.Run(ctx, cfg, doctor.Options{Mode: *mode, Timeout: *timeout, Probes: probes})
	}
	write := rep.WriteText
	if *asJSON {
		write = rep.WriteJSON
	}
	if err := write(stdout); err != nil {
		return err
	}
	if !rep.OK {
		return errChecksFailed
	}
	return nil
}
