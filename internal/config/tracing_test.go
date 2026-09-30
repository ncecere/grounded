package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTracingOffByDefault(t *testing.T) {
	c, err := LoadFrom("", env(nil))
	if err != nil {
		t.Fatal(err)
	}
	tr := c.Tracing
	if tr.Enabled() || tr.Endpoint != "" {
		t.Fatalf("tracing on by default: %+v", tr)
	}
	if tr.Protocol != OTLPProtocolHTTP || tr.ServiceName != "grounded" || tr.Sampler != "parentbased_traceidratio" || tr.SamplerArg != 1 {
		t.Errorf("defaults = %+v", tr)
	}
}

func TestTracingSettings(t *testing.T) {
	c, err := LoadFrom("", env(map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://tempo.monitoring.svc:4318/",
		"OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
		"OTEL_EXPORTER_OTLP_HEADERS":  "Authorization=Bearer%20abc, X-Scope-OrgID=tenant-1",
		"OTEL_SERVICE_NAME":           "grounded-staging",
		"OTEL_TRACES_SAMPLER":         "ParentBased_Always_On",
		"OTEL_TRACES_SAMPLER_ARG":     "0.25",
	}))
	if err != nil {
		t.Fatal(err)
	}
	tr := c.Tracing
	if !tr.Enabled() || tr.Endpoint != "http://tempo.monitoring.svc:4318" || tr.ServiceName != "grounded-staging" ||
		tr.Sampler != "parentbased_always_on" || tr.SamplerArg != 0.25 {
		t.Errorf("tracing = %+v", tr)
	}
	if tr.Headers["Authorization"] != "Bearer abc" || tr.Headers["X-Scope-OrgID"] != "tenant-1" || len(tr.Headers) != 2 {
		t.Errorf("headers = %d entries", len(tr.Headers))
	}
}

func TestTracingInvalidValues(t *testing.T) {
	for key, value := range map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": "tempo:4318",
		"OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
		"OTEL_EXPORTER_OTLP_HEADERS":  "not-a-pair",
		"OTEL_TRACES_SAMPLER":         "jaeger_remote",
		"OTEL_TRACES_SAMPLER_ARG":     "1.5",
		"OTEL_SERVICE_NAME":           "two\nlines",
	} {
		_, err := LoadFrom("", env(map[string]string{key: value}))
		if err == nil || !strings.Contains(err.Error(), key) {
			t.Errorf("%s=%q: want an error naming it, got %v", key, value, err)
		}
	}
	for _, v := range []string{"https://user:pw@collector.example.org", "http://collector.example.org:4318?x=1"} {
		if _, err := LoadFrom("", env(map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": v})); err == nil {
			t.Errorf("endpoint %q accepted", v)
		}
	}
}

// A header value (usually a token) never appears in an error.
func TestTracingHeaderErrorsHideValues(t *testing.T) {
	_, err := LoadFrom("", env(map[string]string{"OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer%zzsecret-token"}))
	if err == nil || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("err = %v", err)
	}
}

// OTEL_EXPORTER_OTLP_HEADERS may come from a file (a mounted Secret), like
// other secrets.
func TestTracingHeadersFromFile(t *testing.T) {
	f := filepath.Join(t.TempDir(), "headers")
	if err := os.WriteFile(f, []byte("Authorization=Basic%20dXNlcjpwdw==\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := LoadFrom("", env(map[string]string{"OTEL_EXPORTER_OTLP_HEADERS_FILE": f}))
	if err != nil || c.Tracing.Headers["Authorization"] != "Basic dXNlcjpwdw==" {
		t.Fatalf("err = %v, headers %d", err, len(c.Tracing.Headers))
	}
}
