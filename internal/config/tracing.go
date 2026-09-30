// OpenTelemetry tracing (docs/operations/tracing.md): the standard OTEL_*
// variables Grounded reads. Tracing is off unless OTEL_EXPORTER_OTLP_ENDPOINT
// is set.

package config

import (
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"
)

// Tracing configures the OpenTelemetry trace exporter.
type Tracing struct {
	// Endpoint is the OTLP base URL (OTEL_EXPORTER_OTLP_ENDPOINT), for
	// example http://tempo.monitoring.svc:4318; over HTTP traces go to
	// Endpoint + /v1/traces. Empty: tracing is off.
	Endpoint string
	// Protocol is OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf (default) or grpc.
	Protocol string
	// Headers are sent with every export (OTEL_EXPORTER_OTLP_HEADERS,
	// "name=value,name2=value2" with URL-encoded values). They may carry
	// tokens: never log them.
	Headers map[string]string
	// ServiceName is OTEL_SERVICE_NAME (default grounded).
	ServiceName string
	// Sampler and SamplerArg are OTEL_TRACES_SAMPLER and
	// OTEL_TRACES_SAMPLER_ARG (default parentbased_traceidratio, 1.0).
	Sampler    string
	SamplerArg float64
}

// Enabled reports whether traces are exported.
func (t Tracing) Enabled() bool { return t.Endpoint != "" }

// Tracing protocol and sampler values.
const (
	OTLPProtocolHTTP        = "http/protobuf"
	OTLPProtocolGRPC        = "grpc"
	DefaultTraceSampler     = "parentbased_traceidratio"
	DefaultTraceServiceName = "grounded"
)

// TraceSamplers are the OTEL_TRACES_SAMPLER values Grounded accepts (the
// SDK's built-in samplers; jaeger_remote and xray are not built in).
var TraceSamplers = []string{
	"always_on", "always_off", "traceidratio",
	"parentbased_always_on", "parentbased_always_off", "parentbased_traceidratio",
}

// TracingDefaults are the built-in tracing settings (off).
func TracingDefaults() Tracing {
	return Tracing{Protocol: OTLPProtocolHTTP, ServiceName: DefaultTraceServiceName, Sampler: DefaultTraceSampler, SamplerArg: 1}
}

var tracingSettings = []setting{
	{key: "OTEL_EXPORTER_OTLP_ENDPOINT", apply: otlpEndpoint},
	{key: "OTEL_EXPORTER_OTLP_PROTOCOL", apply: otlpProtocol},
	{key: "OTEL_EXPORTER_OTLP_HEADERS", secret: true, apply: otlpHeaders},
	{key: "OTEL_SERVICE_NAME", apply: func(c *Config, v string) error {
		v = strings.TrimSpace(v)
		if v == "" {
			v = DefaultTraceServiceName
		}
		if len(v) > 100 || hasControl(v) {
			return errors.New("must be at most 100 characters on one line")
		}
		c.Tracing.ServiceName = v
		return nil
	}},
	{key: "OTEL_TRACES_SAMPLER", apply: func(c *Config, v string) error {
		v = strings.ToLower(strings.TrimSpace(v))
		if v == "" {
			v = DefaultTraceSampler
		}
		if !slices.Contains(TraceSamplers, v) {
			return fmt.Errorf("must be one of %s", strings.Join(TraceSamplers, ", "))
		}
		c.Tracing.Sampler = v
		return nil
	}},
	{key: "OTEL_TRACES_SAMPLER_ARG", apply: func(c *Config, v string) error {
		v = strings.TrimSpace(v)
		if v == "" {
			return nil
		}
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || f < 0 || f > 1 {
			return errors.New("must be a sampling ratio from 0 to 1")
		}
		c.Tracing.SamplerArg = f
		return nil
	}},
}

// otlpEndpoint parses OTEL_EXPORTER_OTLP_ENDPOINT: an http(s) URL without
// credentials, query or fragment ("" turns tracing off).
func otlpEndpoint(c *Config, v string) error {
	v = strings.TrimRight(strings.TrimSpace(v), "/")
	if v == "" {
		c.Tracing.Endpoint = ""
		return nil
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("must be an http(s) URL such as http://tempo.monitoring.svc:4318 (put credentials in OTEL_EXPORTER_OTLP_HEADERS)")
	}
	c.Tracing.Endpoint = v
	return nil
}

// otlpProtocol accepts http/protobuf and grpc (http/json is not built into
// the Go exporters).
func otlpProtocol(c *Config, v string) error {
	v = strings.ToLower(strings.TrimSpace(v))
	switch v {
	case "", OTLPProtocolHTTP:
		c.Tracing.Protocol = OTLPProtocolHTTP
	case OTLPProtocolGRPC:
		c.Tracing.Protocol = OTLPProtocolGRPC
	default:
		return errors.New("must be http/protobuf or grpc")
	}
	return nil
}

// otlpHeaders parses OTEL_EXPORTER_OTLP_HEADERS. Errors never quote a value
// (headers usually carry a token).
func otlpHeaders(c *Config, v string) error {
	out := map[string]string{}
	for i, part := range strings.Split(v, ",") {
		if strings.TrimSpace(part) == "" {
			continue
		}
		name, value, ok := strings.Cut(part, "=")
		name = strings.TrimSpace(name)
		if !ok || !validHeaderName(name) {
			return fmt.Errorf("entry %d must look like name=value (names are HTTP header names)", i+1)
		}
		decoded, err := url.PathUnescape(strings.TrimSpace(value))
		if err != nil || strings.ContainsAny(decoded, "\r\n\x00") {
			return fmt.Errorf("the value of %s is not a valid URL-encoded header value", name)
		}
		out[name] = decoded
	}
	if len(out) == 0 {
		out = nil
	}
	c.Tracing.Headers = out
	return nil
}

// validHeaderName reports whether s is an HTTP token.
func validHeaderName(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r > 0x7e || r <= ' ' || strings.ContainsRune(`"(),/:;<=>?@[\]{}`, r) {
			return false
		}
	}
	return true
}
