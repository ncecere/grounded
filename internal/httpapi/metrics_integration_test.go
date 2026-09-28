package httpapi_test

import (
	"regexp"
	"testing"
)

// One upload, one chat: the pipeline's metrics are recorded with bounded
// labels (docs/operations/monitoring.md). Other tests in the package share
// the process registry, so this checks presence, not exact counts.
func TestMetricsCoverIngestChatRetrievalAndModels(t *testing.T) {
	env := newAgentEnv(t) // uploads and indexes three documents
	ag := env.publishAgent(t, "Metrics", env.agentConfig(env.kb.Id.String()))
	code, _, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "Where can students park?"})
	if code != 200 {
		t.Fatalf("chat = %d %s", code, e)
	}
	code, raw := env.member.raw("GET", "/metrics", nil, nil)
	if code != 200 {
		t.Fatalf("metrics = %d", code)
	}
	conn := regexp.QuoteMeta(env.conn.Name)
	for _, want := range []string{
		`grounded_http_requests_total\{group="chat",method="POST",route="POST /v1/agents/\{team\}/\{agent\}/chat",status="200"\} \d+`,
		`grounded_chat_answers_total\{channel="[a-z]+",outcome="ok"\} \d+`,
		`grounded_chat_first_token_seconds_count\{channel="[a-z]+"\} \d+`,
		`grounded_retrieval_duration_seconds_count\{outcome="ok"\} \d+`,
		`grounded_model_requests_total\{connection="` + conn + `",kind="chat",outcome="ok"\} \d+`,
		`grounded_model_requests_total\{connection="` + conn + `",kind="embedding",outcome="ok"\} \d+`,
		`grounded_model_request_duration_seconds_count\{connection="` + conn + `",kind="embedding"\} \d+`,
		`grounded_ingest_documents_total\{outcome="indexed"\} \d+`,
		`grounded_embedding_batch_inputs_count \d+`,
		`grounded_jobs_worked_total\{kind="[a-z_.]+",outcome="ok"\} \d+`,
	} {
		if !regexp.MustCompile(`(?m)^` + want + `$`).Match(raw) {
			t.Errorf("metrics lack %s", want)
		}
	}
	// No IDs in labels.
	if id := regexp.MustCompile(`(?m)^grounded_[a-z_]+\{[^}]*[0-9a-f]{8}-[0-9a-f]{4}-`).Find(raw); id != nil {
		t.Errorf("a metric label carries an ID: %s", id)
	}
}
