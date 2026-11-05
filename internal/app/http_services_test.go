package app

import (
	"log/slog"
	"reflect"
	"testing"
	"testing/fstest"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/observability"
)

func TestHTTPServicesPreserveInfrastructureAndDomainIdentity(t *testing.T) {
	// Zero-valued service objects are only identity markers: no constructors,
	// database, network, provider calls or methods on these objects are needed.
	s := &Services{}
	base := httpapi.Deps{
		Config: config.Config{AppURL: "http://localhost:9876"},
		Pool:   &pgxpool.Pool{}, KV: &kv.Store{}, Metrics: &observability.Metrics{}, Health: httpapi.NewHealth(nil),
		Log: slog.Default(), Web: fstest.MapFS{"index.html": {Data: []byte("test")}}, WebBuilt: true,
	}
	want := base
	pairs := [][2]string{
		{"AuditExports", "AuditExports"}, {"Teams", "Teams"}, {"Platform", "Platform"}, {"Catalog", "Catalog"},
		{"Sources", "Sources"}, {"Web", "WebSources"}, {"KBs", "KBs"},
		{"APIKeys", "APIKeys"}, {"Limits", "Limits"}, {"Costs", "Costs"},
		{"Agents", "Agents"}, {"Notify", "Notify"}, {"Moderation", "Moderation"},
		{"SystemOne", "SystemOne"}, {"OCR", "OCR"}, {"PII", "PII"}, {"SCIM", "SCIM"}, {"Public", "Public"}, {"Rerank", "Rerank"},
		{"Retention", "Retention"}, {"BreakGlass", "BreakGlass"},
		{"ProfileMigrations", "ProfileMigrations"}, {"Evaluations", "Evaluations"}, {"MCP", "MCP"}, {"OAuth", "OAuth"},
		{"Contextual", "Contextual"}, {"TeamRequests", "TeamRequests"}, {"Webhooks", "Webhooks"},
		{"Gaps", "Gaps"}, {"ContentHealth", "ContentHealth"}, {"AnswerCache", "AnswerCache"}, {"TeamConfig", "TeamConfig"},
	}
	for _, pair := range pairs {
		field := reflect.ValueOf(s).Elem().FieldByName(pair[0])
		field.Set(reflect.New(field.Type().Elem()))
		reflect.ValueOf(&want).Elem().FieldByName(pair[1]).Set(field)
	}
	got := s.withHTTPServices(base)
	if !reflect.DeepEqual(got, want) {
		t.Error("HTTP dependencies changed infrastructure or lost/substituted a domain service")
	}
}
