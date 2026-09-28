GO      ?= go
SQLC    ?= $(shell command -v sqlc 2>/dev/null || echo $(HOME)/go/bin/sqlc)
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
PKG     := github.com/ncecere/grounded
LDFLAGS := -s -w -X $(PKG)/internal/buildinfo.Version=$(VERSION) -X $(PKG)/internal/buildinfo.Commit=$(COMMIT)

export GROUNDED_TEST_DATABASE_URL ?= postgres://grounded:grounded-dev-only@127.0.0.1:55432/postgres?sslmode=disable
export GROUNDED_TEST_VALKEY_URL   ?= redis://127.0.0.1:56379/1

# Kubernetes tooling, installed on first use into bin/k8s-tools/<version>/.
KUSTOMIZE_VERSION   ?= v5.8.1
KUBECONFORM_VERSION ?= v0.8.0
KIND_VERSION        ?= v0.33.0
K8S_TOOLS   := $(CURDIR)/bin/k8s-tools
KUSTOMIZE   := $(K8S_TOOLS)/kustomize-$(KUSTOMIZE_VERSION)/kustomize
KUBECONFORM := $(K8S_TOOLS)/kubeconform-$(KUBECONFORM_VERSION)/kubeconform
KIND        := $(K8S_TOOLS)/kind-$(KIND_VERSION)/kind

# promtool from the official Prometheus release (checksums pinned in
# deploy/observability/scripts/install-promtool.sh), installed on first use.
PROMETHEUS_VERSION ?= 3.15.0
PROMTOOL := $(CURDIR)/bin/obs-tools/prometheus-$(PROMETHEUS_VERSION)/promtool

.PHONY: help deps-up deps-down mail-up demo generate check-generated web web-test e2e web-dev fake-proxy widget-demo build run migrate test test-authz test-unit lint fmt docker k8s-validate k8s-smoke k8s-load k8s-restore-rehearsal vendor-k8s cover-report upgrade-test deps-inventory obs-validate obs-generate

help: ## Show targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

deps-up: ## Start local Postgres + Valkey
	docker compose up -d --wait

deps-down: ## Stop local dependencies (keeps data)
	docker compose down

mail-up: ## Start Mailpit for notification email (SMTP 127.0.0.1:1025, inbox http://127.0.0.1:8025)
	docker compose --profile mail up -d mailpit

demo: ## Try Grounded: dev sign-in, the fake models and the Go docs demo on :8080 (compose.demo.yaml; docs/demo.md)
	docker compose -f compose.demo.yaml up --build

generate: ## Regenerate sqlc queries and OpenAPI types (Go and TypeScript)
	$(SQLC) generate
	$(GO) generate ./...
	cd web && npm run gen

check-generated: generate ## Fail if generated code is stale
	@git diff --exit-code -- internal/store/dbgen internal/httpapi/apitypes web/src/api/schema.gen.ts || \
		(echo "generated code is stale: run 'make generate' and commit" && exit 1)

web: ## Build the web UI into web/dist (embedded by `make build`)
	cd web && npm ci --ignore-scripts && npm run build

web-test: ## Type-check and test the web UI
	cd web && npm run typecheck && npm test

e2e: web build ## Browser end-to-end tests (web/e2e, Playwright): a throwaway server on its own database (needs `make deps-up`); E2E_ARGS="--ui"
	cd web && npx playwright install chromium && npx playwright test $(E2E_ARGS)

web-dev: ## Run the Vite dev server on :5173 (proxies to `make run` on :8080)
	cd web && npm run dev

fake-proxy: ## Run a fake OpenAI-compatible proxy on :8090 (key sk-dev-fake)
	$(GO) run ./cmd/fakeproxy

widget-demo: ## Serve a page embedding the widget on :8095 (GROUNDED_URL, WIDGET_AGENT, WIDGET_KEY)
	$(GO) run ./cmd/widgetdemo

build: ## Build bin/grounded (run `make web` first to include the UI)
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags '$(LDFLAGS)' -o bin/grounded ./cmd/grounded

run: build ## Run api + worker locally using .env
	@test -f .env || cp .env.example .env
	set -a && . ./.env && set +a && ./bin/grounded serve

migrate: build ## Apply migrations using .env
	set -a && . ./.env && set +a && ./bin/grounded migrate

# The authorization matrix (internal/httpapi, TestAuthorizationMatrix*): about
# 3,600 calls, minutes under -race on a small runner. CI runs it in its own
# job (`authz`, `make test-authz`) and the `test` job skips it (SKIP_AUTHZ=1).
AUTHZ_TESTS := ^TestAuthorizationMatrix

test: ## All tests, including integration tests (needs `make deps-up`); COVER=1 writes coverage.out; SKIP_AUTHZ=1 leaves out the authorization matrix
	$(GO) test -race -count=1 -timeout 25m $(if $(SKIP_AUTHZ),-skip '$(AUTHZ_TESTS)') $(if $(COVER),-covermode=atomic -coverpkg=./internal/... -coverprofile=coverage.out) ./...

test-authz: ## The authorization matrix alone (CI job `authz`; needs `make deps-up`)
	$(GO) test -race -count=1 -timeout 25m -run '$(AUTHZ_TESTS)' ./internal/httpapi/

deps-inventory: ## Regenerate the dependency and license tables in docs/security/dependencies.md
	$(GO) mod download
	$(GO) run ./tools/depinventory

cover-report: ## Summarise coverage.out per package (run `make test COVER=1` first)
	@$(GO) run ./tools/coverreport coverage.out

test-unit: ## Tests that need no infrastructure (integration tests skip)
	GROUNDED_TEST_DATABASE_URL= GROUNDED_TEST_VALKEY_URL= $(GO) test -count=1 ./...

# Code size and complexity guards (CONTRIBUTING.md, "Code size and complexity").
# Generated code (dbgen, apitypes, *.gen.go) and tests are exempt from gocyclo.
GOCYCLO_MAX    := 20
GOCYCLO_IGNORE := _test\.go$$|/dbgen/|/apitypes/|\.gen\.go$$

lint: ## gofmt, vet, staticcheck, govulncheck, complexity and size guards
	@test -z "$$(gofmt -l cmd internal migrations tools)" || (gofmt -l cmd internal migrations tools && exit 1)
	$(GO) vet ./...
	$(GO) run honnef.co/go/tools/cmd/staticcheck@latest ./...
	$(GO) run golang.org/x/vuln/cmd/govulncheck@latest ./...
	$(GO) run github.com/fzipp/gocyclo/cmd/gocyclo@v0.6.0 -over $(GOCYCLO_MAX) -ignore '$(GOCYCLO_IGNORE)' cmd internal tools
	$(GO) run ./tools/checksize -file 600 -testfile 1200 -func 100 cmd internal tools

fmt: ## Format Go code
	gofmt -w cmd internal migrations tools

docker: ## Build the container image
	docker build --build-arg VERSION=$(VERSION) --build-arg COMMIT=$(COMMIT) -t grounded:$(VERSION) .

$(KUSTOMIZE):
	GOBIN=$(dir $@) $(GO) install sigs.k8s.io/kustomize/kustomize/v5@$(KUSTOMIZE_VERSION)

$(KUBECONFORM):
	GOBIN=$(dir $@) $(GO) install github.com/yannh/kubeconform/cmd/kubeconform@$(KUBECONFORM_VERSION)

$(KIND):
	GOBIN=$(dir $@) $(GO) install sigs.k8s.io/kind@$(KIND_VERSION)

k8s-validate: $(KUSTOMIZE) $(KUBECONFORM) ## Render every Kubernetes overlay and component set; validate with kubeconform
	GO=$(GO) KUSTOMIZE=$(KUSTOMIZE) KUBECONFORM=$(KUBECONFORM) deploy/kubernetes/scripts/validate.sh

k8s-smoke: $(KIND) $(KUSTOMIZE) ## Deploy the manifests on a throwaway kind cluster and check readiness (needs docker)
	KIND=$(KIND) KUSTOMIZE=$(KUSTOMIZE) deploy/kubernetes/scripts/kind-smoke.sh

k8s-load: $(KIND) $(KUSTOMIZE) ## Load tests (k6, fake models) on a throwaway kind cluster; SCENARIOS="chat retrieve openai ingest mixed"
	KIND=$(KIND) KUSTOMIZE=$(KUSTOMIZE) deploy/loadtest/run.sh $(SCENARIOS)

k8s-restore-rehearsal: $(KIND) $(KUSTOMIZE) ## Back up, destroy and restore Postgres and the bucket on a throwaway kind cluster, timing each step
	KIND=$(KIND) KUSTOMIZE=$(KUSTOMIZE) deploy/kubernetes/scripts/restore-rehearsal.sh

upgrade-test: ## Upgrade test with docker: the previous image migrates and gets data, this one migrates; both must serve it (OLD_REF, OLD_IMAGE, NEW_IMAGE; docs/operations/upgrades.md)
	deploy/kubernetes/scripts/upgrade-test.sh

$(PROMTOOL):
	PROMETHEUS_VERSION=$(PROMETHEUS_VERSION) DEST=$@ deploy/observability/scripts/install-promtool.sh

obs-generate: ## Write components/alerts and components/dashboards from deploy/observability
	$(GO) run ./tools/obsgen

obs-validate: $(PROMTOOL) ## Check the alert rules (promtool check and unit tests), the dashboards and the generated components
	$(PROMTOOL) check rules deploy/observability/alerts/grounded.rules.yaml
	$(PROMTOOL) test rules deploy/observability/alerts/grounded.rules.test.yaml
	$(GO) run ./tools/obsgen -check
	$(GO) test -count=1 -run 'TestMetricNames|TestDashboards|TestAlertRules|TestPrometheusRuleComponent' ./internal/observability/

vendor-k8s: $(KUSTOMIZE) ## Render the Kubernetes base into DEST=<dir> [COMPONENTS="postgres-single ..."]
	@test -n "$(DEST)" || (echo 'usage: make vendor-k8s DEST=<dir> [COMPONENTS="postgres-single valkey-single"]' && exit 2)
	GO=$(GO) KUSTOMIZE=$(KUSTOMIZE) deploy/kubernetes/scripts/vendor.sh "$(DEST)" $(COMPONENTS)
