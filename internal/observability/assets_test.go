package observability_test

// Checks of the Grafana dashboards and alert rules in deploy/observability
// against the metrics this binary exposes (make obs-validate runs them, as
// does make test). promtool checks the rules' syntax and behaviour.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/retention"
)

const obsDir = "../../deploy/observability"

// Dashboards shipped, by file name.
var dashboardFiles = []string{"overview.json", "api.json", "chat-retrieval.json", "ingest-jobs.json", "models-moderation.json"}

// externalMetrics are metrics Grounded doesn't expose that the dashboards
// and rules may use: Prometheus's own, kube-state-metrics and the kubelet
// (documented dependencies in docs/operations/monitoring.md).
var externalMetrics = []string{
	"ALERTS", "up",
	"kube_cronjob_status_last_successful_time", "kube_job_status_failed",
	"kubelet_volume_stats_used_bytes", "kubelet_volume_stats_capacity_bytes", "kubelet_volume_stats_available_bytes",
}

// knownMetrics lists every series name the binary can expose (histograms
// with their _bucket, _sum and _count series), the Go and process
// collectors' names and the external metrics.
func knownMetrics(t *testing.T) map[string]bool {
	t.Helper()
	m := observability.NewMetrics()
	m.Register(retention.NewMetrics().Collectors()...)
	m.Register(observability.NewPoolCollector(nil), observability.NewStateCollector(nil, nil))
	known := map[string]bool{}
	for _, n := range m.Names() {
		known[n] = true
		for _, s := range []string{"_bucket", "_sum", "_count"} {
			known[n+s] = true
		}
	}
	for _, n := range externalMetrics {
		known[n] = true
	}
	return known
}

func isRuntimeMetric(name string) bool {
	return strings.HasPrefix(name, "go_") || strings.HasPrefix(name, "process_")
}

var (
	promStrings   = regexp.MustCompile(`"(?:[^"\\]|\\.)*"`)
	promVars      = regexp.MustCompile(`\$\{?\w+\}?`)
	promMatchers  = regexp.MustCompile(`\{[^}]*\}`)
	promRanges    = regexp.MustCompile(`\[[^\]]*\]`)
	promGrouping  = regexp.MustCompile(`\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)`)
	promOffset    = regexp.MustCompile(`\boffset\s+\w+`)
	promTokens    = regexp.MustCompile(`\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_:][A-Za-z0-9_:]*(\s*\()?`)
	promKeywords  = map[string]bool{"and": true, "or": true, "unless": true, "bool": true, "inf": true, "nan": true, "Inf": true, "NaN": true}
	labelValuesOf = regexp.MustCompile(`label_values\(\s*([A-Za-z_:][A-Za-z0-9_:]*)`)
)

// metricNames returns the metric names a PromQL expression selects.
func metricNames(expr string) []string {
	s := promStrings.ReplaceAllString(expr, `""`)
	s = promVars.ReplaceAllString(s, "")
	s = promMatchers.ReplaceAllString(s, "")
	s = promRanges.ReplaceAllString(s, "")
	s = promGrouping.ReplaceAllString(s, "")
	s = promOffset.ReplaceAllString(s, "")
	var names []string
	for _, m := range promTokens.FindAllStringSubmatch(s, -1) {
		tok := m[0]
		if m[1] != "" || (tok[0] >= '0' && tok[0] <= '9') || promKeywords[tok] {
			continue // a function call, a number or a keyword
		}
		names = append(names, tok)
	}
	return names
}

func TestMetricNames(t *testing.T) {
	got := metricNames(`histogram_quantile(0.95, sum by (le, route) (rate(grounded_x_bucket{a="b",c=~"d|e"}[$__rate_interval]))) / 1e3 ` +
		`and on (namespace) max(grounded:y:rate5m offset 1h) > bool 2 unless label_replace(z, "dst", "$1", "src", "(.*)")`)
	if want := []string{"grounded_x_bucket", "grounded:y:rate5m", "z"}; !slices.Equal(got, want) {
		t.Fatalf("metricNames = %v, want %v", got, want)
	}
}

// ---- dashboards ----------------------------------------------------------------

type dashboard struct {
	UID           string `json:"uid"`
	Title         string `json:"title"`
	SchemaVersion int    `json:"schemaVersion"`
	Templating    struct {
		List []struct {
			Name       string          `json:"name"`
			Type       string          `json:"type"`
			Query      json.RawMessage `json:"query"`
			Datasource *datasource     `json:"datasource"`
		} `json:"list"`
	} `json:"templating"`
	Panels []panel `json:"panels"`
}

type datasource struct {
	Type string `json:"type"`
	UID  string `json:"uid"`
}

type panel struct {
	Type       string      `json:"type"`
	Title      string      `json:"title"`
	Datasource *datasource `json:"datasource"`
	Targets    []struct {
		Expr       string      `json:"expr"`
		Datasource *datasource `json:"datasource"`
	} `json:"targets"`
	Panels []panel `json:"panels"` // collapsed rows
}

func (p panel) all() []panel {
	out := []panel{p}
	for _, c := range p.Panels {
		out = append(out, c.all()...)
	}
	return out
}

const dsVar = "${DS_PROMETHEUS}"

func TestDashboards(t *testing.T) {
	known := knownMetrics(t)
	recorded := recordedNames(t, loadRules(t))
	entries, err := os.ReadDir(filepath.Join(obsDir, "dashboards"))
	if err != nil {
		t.Fatal(err)
	}
	var files []string
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".json" {
			files = append(files, e.Name())
		}
	}
	slices.Sort(files)
	want := slices.Clone(dashboardFiles)
	slices.Sort(want)
	if !slices.Equal(files, want) {
		t.Errorf("dashboards = %v, want %v", files, want)
	}
	uids := map[string]string{}
	for _, f := range files {
		raw, err := os.ReadFile(filepath.Join(obsDir, "dashboards", f))
		if err != nil {
			t.Fatal(err)
		}
		var d dashboard
		if err := json.Unmarshal(raw, &d); err != nil {
			t.Errorf("%s: %v", f, err)
			continue
		}
		if prev, dup := uids[d.UID]; d.UID == "" || dup {
			t.Errorf("%s: uid %q missing or also used by %s", f, d.UID, prev)
		}
		uids[d.UID] = f
		if d.SchemaVersion < 39 || !strings.HasPrefix(d.Title, "Grounded / ") {
			t.Errorf("%s: schemaVersion %d, title %q", f, d.SchemaVersion, d.Title)
		}
		checkDashboard(t, f, d, raw, known, recorded)
	}
}

func checkDashboard(t *testing.T, f string, d dashboard, raw []byte, known, recorded map[string]bool) {
	t.Helper()
	hasDSVar := false
	for _, v := range d.Templating.List {
		if v.Name == "DS_PROMETHEUS" && v.Type == "datasource" {
			hasDSVar = true
		}
		if v.Type == "query" {
			if v.Datasource == nil || v.Datasource.UID != dsVar {
				t.Errorf("%s: variable %s does not use %s", f, v.Name, dsVar)
			}
			for _, m := range labelValuesOf.FindAllStringSubmatch(string(v.Query), -1) {
				checkName(t, f+" variable "+v.Name, m[1], known, recorded)
			}
		}
	}
	if !hasDSVar {
		t.Errorf("%s: no DS_PROMETHEUS data source variable", f)
	}
	// No data source is hard-coded anywhere (only the variable and Grafana's
	// built-in annotations).
	for _, m := range regexp.MustCompile(`"uid":\s*"([^"]*)"`).FindAllStringSubmatch(string(raw), -1) {
		if m[1] != dsVar && m[1] != "-- Grafana --" && m[1] != d.UID {
			t.Errorf("%s: hard-coded uid %q", f, m[1])
		}
	}
	n := 0
	for _, top := range d.Panels {
		for _, p := range top.all() {
			if p.Type == "row" {
				continue
			}
			n++
			if p.Datasource == nil || p.Datasource.UID != dsVar || len(p.Targets) == 0 {
				t.Errorf("%s: panel %q has no targets or does not use %s", f, p.Title, dsVar)
			}
			for _, tg := range p.Targets {
				if tg.Datasource == nil || tg.Datasource.UID != dsVar {
					t.Errorf("%s: a target of %q does not use %s", f, p.Title, dsVar)
				}
				names := metricNames(tg.Expr)
				if len(names) == 0 {
					t.Errorf("%s: %q: expression selects no metric: %s", f, p.Title, tg.Expr)
				}
				for _, name := range names {
					checkName(t, f+" panel "+p.Title, name, known, recorded)
				}
			}
		}
	}
	if n < 6 {
		t.Errorf("%s: only %d panels", f, n)
	}
}

func checkName(t *testing.T, where, name string, known, recorded map[string]bool) {
	t.Helper()
	if !known[name] && !recorded[name] && !isRuntimeMetric(name) {
		t.Errorf("%s: unknown metric %s", where, name)
	}
}

// ---- alert rules ----------------------------------------------------------------

type ruleFile struct {
	Groups []struct {
		Name  string `yaml:"name"`
		Rules []struct {
			Record      string            `yaml:"record"`
			Alert       string            `yaml:"alert"`
			Expr        string            `yaml:"expr"`
			Labels      map[string]string `yaml:"labels"`
			Annotations map[string]string `yaml:"annotations"`
		} `yaml:"rules"`
	} `yaml:"groups"`
}

func loadRules(t *testing.T) ruleFile {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(obsDir, "alerts", "grounded.rules.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var rf ruleFile
	if err := yaml.Unmarshal(raw, &rf); err != nil {
		t.Fatal(err)
	}
	return rf
}

func recordedNames(t *testing.T, rf ruleFile) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	for _, g := range rf.Groups {
		for _, r := range g.Rules {
			if r.Record != "" {
				out[r.Record] = true
			}
		}
	}
	return out
}

func TestAlertRules(t *testing.T) {
	rf := loadRules(t)
	known, recorded := knownMetrics(t), recordedNames(t, rf)
	runbook, err := os.ReadFile("../../docs/operations/alerts.md")
	if err != nil {
		t.Fatal(err)
	}
	headings := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^## (\S+)\s*$`).FindAllStringSubmatch(string(runbook), -1) {
		headings[m[1]] = true
	}
	alerts := map[string]bool{}
	for _, g := range rf.Groups {
		for _, r := range g.Rules {
			for _, name := range metricNames(r.Expr) {
				checkName(t, "rule "+r.Alert+r.Record, name, known, recorded)
			}
			if r.Alert == "" {
				continue
			}
			if alerts[r.Alert] {
				t.Errorf("alert %s is defined twice", r.Alert)
			}
			alerts[r.Alert] = true
			if !slices.Contains([]string{"critical", "warning", "info"}, r.Labels["severity"]) || r.Labels["service"] != "grounded" {
				t.Errorf("%s: labels %v", r.Alert, r.Labels)
			}
			a := r.Annotations
			if a["summary"] == "" || a["description"] == "" {
				t.Errorf("%s: summary and description are required", r.Alert)
			}
			want := "https://github.com/ncecere/grounded/blob/main/docs/operations/alerts.md#" + strings.ToLower(r.Alert)
			if a["runbook_url"] != want {
				t.Errorf("%s: runbook_url %q, want %q", r.Alert, a["runbook_url"], want)
			}
			if !headings[r.Alert] {
				t.Errorf("%s: docs/operations/alerts.md has no section ## %s", r.Alert, r.Alert)
			}
		}
	}
	for h := range headings {
		if strings.HasPrefix(h, "Grounded") && !alerts[h] {
			t.Errorf("docs/operations/alerts.md documents %s, which no rule defines", h)
		}
	}
}

// The Prometheus Operator component carries exactly the rule file's groups
// (go run ./tools/obsgen writes it).
func TestPrometheusRuleComponentMatchesRules(t *testing.T) {
	read := func(path string, out any) {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := yaml.Unmarshal(raw, out); err != nil {
			t.Fatal(err)
		}
	}
	var rules map[string]any
	read(filepath.Join(obsDir, "alerts", "grounded.rules.yaml"), &rules)
	var cr struct {
		Kind string         `yaml:"kind"`
		Spec map[string]any `yaml:"spec"`
	}
	read("../../deploy/kubernetes/components/alerts/prometheusrule.yaml", &cr)
	if cr.Kind != "PrometheusRule" || !reflect.DeepEqual(cr.Spec, rules) {
		t.Fatal("components/alerts/prometheusrule.yaml is stale: run `go run ./tools/obsgen`")
	}
}

// components/dashboards carries copies of the dashboards (go run
// ./tools/obsgen writes them), one ConfigMap each.
func TestDashboardsComponentMatchesDashboards(t *testing.T) {
	const dir = "../../deploy/kubernetes/components/dashboards"
	kust, err := os.ReadFile(filepath.Join(dir, "kustomization.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range dashboardFiles {
		want, err := os.ReadFile(filepath.Join(obsDir, "dashboards", f))
		if err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(filepath.Join(dir, f))
		if err != nil || !slices.Equal(got, want) {
			t.Errorf("components/dashboards/%s is stale: run `go run ./tools/obsgen`", f)
		}
		if !strings.Contains(string(kust), "files: ["+f+"]") {
			t.Errorf("components/dashboards/kustomization.yaml does not generate a ConfigMap for %s", f)
		}
	}
}
