// Command e2eserver runs a throwaway Grounded for the Playwright suite
// (web/e2e, `make e2e`). Playwright starts it as its webServer; it can also be
// run by hand, so that `npx playwright test --ui` reuses it.
//
//	go build -o bin/e2eserver ./tools/e2eserver && bin/e2eserver
//
// It creates its own database (E2E_DB_NAME, default grounded_e2e) on the
// Postgres at E2E_DATABASE_URL, serves the fake model gateway
// (internal/testutil.FakeProxy, as `make fake-proxy`) on E2E_FAKE_ADDR, and
// runs `grounded serve` (E2E_GROUNDED_BIN, default bin/grounded, built with
// the UI) with development sign-in on a loopback APP_URL (E2E_PORT). Valkey
// keys get a per-run prefix. On SIGINT or SIGTERM it stops Grounded, drops
// the database, deletes its Valkey keys and removes its blob directory.
//
// Defaults suit the local compose stack (`make deps-up`); CI sets
// E2E_DATABASE_URL and E2E_VALKEY_URL to its service containers. Nothing
// reaches the internet: the suite uses upload sources and local pages only.
package main

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/ncecere/grounded/internal/testutil"
)

// The public example keys from .env.example: Grounded accepts them only on a
// loopback APP_URL.
const (
	devEncryptionKey = "dhi4PJ88URUmYkB0gc7BGWkWI2KrYJBM5bdj7IfEfTo="
	devPepper        = "FKaLRuR10brhXmbFfmm+9j92BGr82C9qu2OYaBxwfic="
	// FakeKey is the API key of the fake gateway (web/e2e/env.ts knows it).
	fakeKey = "sk-e2e-fake"
)

type settings struct {
	adminURL  string // Postgres URL of a role that may create databases
	dbName    string
	valkeyURL string
	port      string
	fakeAddr  string
	bin       string
	logPath   string
}

func load() (settings, error) {
	s := settings{
		adminURL:  cmp.Or(os.Getenv("E2E_DATABASE_URL"), "postgres://grounded:grounded-dev-only@127.0.0.1:55432/postgres?sslmode=disable"),
		dbName:    cmp.Or(os.Getenv("E2E_DB_NAME"), "grounded_e2e"),
		valkeyURL: cmp.Or(os.Getenv("E2E_VALKEY_URL"), "redis://127.0.0.1:56379/0"),
		port:      cmp.Or(os.Getenv("E2E_PORT"), "18480"),
		fakeAddr:  cmp.Or(os.Getenv("E2E_FAKE_ADDR"), "127.0.0.1:18490"),
		bin:       cmp.Or(os.Getenv("E2E_GROUNDED_BIN"), "bin/grounded"),
		logPath:   cmp.Or(os.Getenv("E2E_SERVER_LOG"), "web/e2e-output/server.log"),
	}
	// Never the development database: the harness drops what it creates.
	if !regexp.MustCompile(`^grounded_e2e[a-z0-9_]*$`).MatchString(s.dbName) {
		return s, fmt.Errorf("E2E_DB_NAME %q must start with grounded_e2e", s.dbName)
	}
	if s.port == "8080" {
		return s, errors.New("E2E_PORT 8080 is the development server's port")
	}
	if _, err := os.Stat(s.bin); err != nil {
		return s, fmt.Errorf("%s: %w (run `make web build` first)", s.bin, err)
	}
	return s, nil
}

func main() {
	log.SetFlags(log.Ltime)
	log.SetPrefix("e2eserver: ")
	s, err := load()
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, s); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, s settings) (err error) {
	dbURL, err := createDatabase(ctx, s)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, dropDatabase(s)) }()

	prefix := "grounded-e2e-" + randomHex(4) + ":"
	defer func() { err = errors.Join(err, deleteKeys(s.valkeyURL, prefix)) }()

	blobs, err := os.MkdirTemp("", "grounded-e2e-blobs-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(blobs)

	fake, err := serveFake(s.fakeAddr)
	if err != nil {
		return err
	}
	defer fake.Close()

	if err := os.MkdirAll(filepath.Dir(s.logPath), 0o755); err != nil {
		return err
	}
	logFile, err := os.Create(s.logPath)
	if err != nil {
		return err
	}
	defer logFile.Close()

	appURL := "http://127.0.0.1:" + s.port
	cmd := exec.Command(s.bin, "serve")
	cmd.Env = serverEnv(s, appURL, dbURL, prefix, blobs)
	cmd.Stdout, cmd.Stderr = logFile, logFile
	if err := cmd.Start(); err != nil {
		return err
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	defer stopServer(cmd, exited)

	if err := waitReady(ctx, appURL, exited); err != nil {
		return fmt.Errorf("%w (log: %s)", err, s.logPath)
	}
	log.Printf("ready: Grounded on %s, fake models on http://%s/v1, database %s, log %s", appURL, s.fakeAddr, s.dbName, s.logPath)
	select {
	case <-ctx.Done():
		log.Print("stopping")
		return nil
	case err := <-exited:
		exited <- err
		return fmt.Errorf("grounded exited: %v (log: %s)", err, s.logPath)
	}
}

// serverEnv is a clean environment: nothing from the developer's .env leaks in.
func serverEnv(s settings, appURL, dbURL, prefix, blobs string) []string {
	env := []string{
		"APP_URL=" + appURL,
		"HTTP_ADDR=127.0.0.1:" + s.port,
		"DATABASE_URL=" + dbURL,
		"VALKEY_URL=" + s.valkeyURL,
		"VALKEY_PREFIX=" + prefix,
		"MIGRATE_ON_START=true",
		"ENCRYPTION_KEY=" + devEncryptionKey,
		"API_KEY_PEPPER=" + devPepper,
		"BLOB_BACKEND=fs",
		"BLOB_DIR=" + blobs,
		"DEV_AUTH=true",
		"LOG_FORMAT=text",
		"LOG_LEVEL=info",
		"SHUTDOWN_DELAY=0s",
		// Every spec signs in and chats from one address.
		"LOGIN_ATTEMPTS_PER_MINUTE=10000",
		"REQUESTS_PER_MINUTE=100000",
		"EMBED_BATCH_WAIT=10ms",
	}
	for _, k := range []string{"PATH", "HOME", "TMPDIR"} {
		if v, ok := os.LookupEnv(k); ok {
			env = append(env, k+"="+v)
		}
	}
	return env
}

func createDatabase(ctx context.Context, s settings) (string, error) {
	conn, err := pgx.Connect(ctx, s.adminURL)
	if err != nil {
		return "", fmt.Errorf("connect to Postgres (E2E_DATABASE_URL; `make deps-up` locally): %w", err)
	}
	defer conn.Close(context.Background())
	name := pgx.Identifier{s.dbName}.Sanitize()
	if _, err := conn.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
		return "", err
	}
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		return "", err
	}
	u, err := url.Parse(s.adminURL)
	if err != nil {
		return "", err
	}
	u.Path = "/" + s.dbName
	return u.String(), nil
}

func dropDatabase(s settings) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, s.adminURL)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	_, err = conn.Exec(ctx, "DROP DATABASE IF EXISTS "+pgx.Identifier{s.dbName}.Sanitize()+" WITH (FORCE)")
	if err == nil {
		log.Printf("dropped database %s", s.dbName)
	}
	return err
}

func deleteKeys(rawURL, prefix string) error {
	opts, err := redis.ParseURL(rawURL)
	if err != nil {
		return err
	}
	c := redis.NewClient(opts)
	defer c.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	iter := c.Scan(ctx, 0, prefix+"*", 500).Iterator()
	for iter.Next(ctx) {
		if err := c.Del(ctx, iter.Val()).Err(); err != nil {
			return err
		}
	}
	return iter.Err()
}

// serveFake serves the fake OpenAI-compatible gateway. Its models are the
// ones web/e2e/seed.setup.ts registers.
func serveFake(addr string) (*http.Server, error) {
	p, h := testutil.NewFakeProxyHandler(fakeKey)
	p.AddChatModel("e2e-chat")
	p.AddEmbeddingModel("e2e-embed", 64)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("fake gateway (E2E_FAKE_ADDR): %w", err)
	}
	srv := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second, ErrorLog: log.New(io.Discard, "", 0)}
	go func() { _ = srv.Serve(ln) }()
	return srv, nil
}

func waitReady(ctx context.Context, appURL string, exited chan error) error {
	deadline := time.Now().Add(2 * time.Minute)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-exited:
			exited <- err
			return fmt.Errorf("grounded exited while starting: %v", err)
		case <-time.After(200 * time.Millisecond):
		}
		res, err := http.Get(appURL + "/readyz")
		if err == nil {
			res.Body.Close()
			if res.StatusCode == http.StatusOK {
				return nil
			}
		}
	}
	return errors.New("grounded was not ready within 2 minutes")
}

func stopServer(cmd *exec.Cmd, exited chan error) {
	_ = cmd.Process.Signal(syscall.SIGTERM)
	select {
	case <-exited:
	case <-time.After(20 * time.Second):
		_ = cmd.Process.Kill()
		<-exited
	}
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
