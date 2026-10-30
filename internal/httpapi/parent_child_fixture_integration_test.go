package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// Parent/child retrieval fixtures (#20, docs/parent-child-retrieval.md). The fake embedder is a bag of words, so a question that names a topic
// word finds the passage that holds it, and nothing about answer quality is measured here: these tests pin mechanics.

// parentDoc is a handbook of two sections of n paragraphs each. Paragraph k of a section holds the word "<section><k>x" once, so a question
// naming it finds that paragraph, and each paragraph is about 110 tokens, so a passage of 128 holds one.
func parentDoc(n int) string {
	var b strings.Builder
	b.WriteString("# Campus handbook\n\n")
	for _, section := range []string{"parking", "housing"} {
		fmt.Fprintf(&b, "## %s rules\n\n", strings.ToUpper(section[:1])+section[1:])
		for k := 0; k < n; k++ {
			fmt.Fprintf(&b, "The %s%dx rule applies to every student, every office and every visitor on campus. Requests are made on the form, "+
				"approved by the registrar, recorded in the student record, and reviewed each term by the committee, which publishes its decisions "+
				"with the deadlines, the fees, the appeals process and the exceptions for part-time, evening, online and exchange students "+
				"in the handbook for %s number %d. Students may ask the office for help at any time during the term, and staff answer by email within two days.\n\n", section, k, section, k)
		}
	}
	return b.String()
}

// parentEnv is an agent environment with a second embedding profile that has parents (the same model and passage size as the default one), a
// source and a knowledge base on it, and an agent over that knowledge base.
type parentEnv struct {
	*agentEnv
	profile apitypes.EmbeddingProfile
	source  apitypes.DataSource
	kbOn    apitypes.KnowledgeBase
	agent   apitypes.Agent
}

// index is a profile, a source holding the handbook and a knowledge base on them.
type index struct {
	profile apitypes.EmbeddingProfile
	source  apitypes.DataSource
	kb      apitypes.KnowledgeBase
}

// addIndex makes another profile (parent size parentTokens, 0 for none), a source with the handbook of n paragraphs per section and a
// knowledge base on them, all named after key.
func (env *parentEnv) addIndex(t *testing.T, key string, parentTokens int32, n int) index {
	t.Helper()
	var profiles []apitypes.EmbeddingProfile
	if code := env.admin.get("/v1/admin/embedding-profiles", &profiles); code != 200 || len(profiles) == 0 {
		t.Fatalf("profiles = %d", code)
	}
	body := map[string]any{"key": key, "name": key, "modelId": profiles[0].Model.Id,
		"chunkSize": 128, "chunkOverlap": 16, "documentPrefix": "search_document: ", "queryPrefix": "search_query: "}
	if parentTokens > 0 {
		body["parentTokens"] = parentTokens
	}
	var ix index
	code, e := env.admin.call("POST", "/v1/admin/embedding-profiles", body, &ix.profile, nil)
	mustCode(t, "profile "+key, code, e, 201, "")
	if ix.profile.ParentTokens != parentTokens {
		t.Fatalf("parentTokens = %d, want %d", ix.profile.ParentTokens, parentTokens)
	}
	code, e = env.owner.call("POST", env.base+"/sources", map[string]any{"name": key, "classification": "open", "embeddingProfileId": ix.profile.Id}, &ix.source, nil)
	mustCode(t, "source "+key, code, e, 201, "")
	env.uploadHandbook(t, ix.source.Id, "handbook.md", parentDoc(n))
	code, e = env.owner.call("POST", env.base+"/kbs", map[string]any{"name": key, "topK": 4, "embeddingProfileId": ix.profile.Id}, &ix.kb, nil)
	mustCode(t, "kb "+key, code, e, 201, "")
	code, e = env.owner.call("PUT", env.base+"/kbs/"+ix.kb.Id.String()+"/sources/"+ix.source.Id.String(), nil, &ix.kb, nil)
	mustCode(t, "attach "+key, code, e, 200, "")
	return ix
}

// newParentEnv builds the environment with an index whose profile has a parent size of parentTokens, the handbook of n paragraphs per
// section uploaded, and an agent over its knowledge base.
func newParentEnv(t *testing.T, parentTokens int32, n int) *parentEnv {
	return newParentEnvWith(t, nil, parentTokens, n)
}

func newParentEnvWith(t *testing.T, mutate func(*config.Config), parentTokens int32, n int) *parentEnv {
	t.Helper()
	env := &parentEnv{agentEnv: newAgentEnvWith(t, mutate)}
	ix := env.addIndex(t, fmt.Sprintf("parents-%d", parentTokens), parentTokens, n)
	env.profile, env.source, env.kbOn = ix.profile, ix.source, ix.kb
	env.agent = env.publishAgent(t, "Parent help", env.agentConfig(env.kbOn.Id.String()))
	return env
}

// uploadStatus uploads a file to a source and returns the upload's status (created, replaced or unchanged), after every document is ready.
func (env *parentEnv) uploadStatus(t *testing.T, src uuid.UUID, name, text string) string {
	t.Helper()
	docs := env.base + "/sources/" + src.String() + "/documents"
	code, results, e := env.owner.uploadFiles(docs, []upload{{name, []byte(text)}}, "")
	if code != 200 || len(results) != 1 {
		t.Fatalf("upload %s = %d %s %+v", name, code, e, results)
	}
	for _, d := range env.owner.waitForDocuments(t, docs) {
		if d.Status != "ready" {
			t.Fatalf("document %s = %s", d.Filename, d.Status)
		}
	}
	return string(results[0].Status)
}

// uploadHandbook uploads a file that is new or changed.
func (env *parentEnv) uploadHandbook(t *testing.T, src uuid.UUID, name, text string) {
	t.Helper()
	if st := env.uploadStatus(t, src, name, text); st != "created" && st != "replaced" {
		t.Fatalf("upload %s was %s", name, st)
	}
}

// deleteFrom deletes a document of a source by filename.
func (env *parentEnv) deleteFrom(t *testing.T, src uuid.UUID, filename string) {
	t.Helper()
	var page apitypes.DocumentPage
	docs := env.base + "/sources/" + src.String() + "/documents"
	env.owner.get(docs, &page)
	for _, d := range page.Items {
		if d.Filename == filename {
			code, e := env.owner.call("DELETE", docs+"/"+d.Id.String(), nil, nil, nil)
			mustCode(t, "delete document", code, e, 200, "")
			return
		}
	}
	t.Fatalf("no document %s", filename)
}

// parentRow is one stored passage with its parent range.
type parentRow struct {
	ID                      uuid.UUID
	Ordinal                 int32
	Tokens                  int32
	First, Last             *int32
	Content, Document, File string
}

// rows are a source's passages under a profile, in document and ordinal order.
func (env *parentEnv) rows(t *testing.T, src, profile uuid.UUID) []parentRow {
	t.Helper()
	res, err := env.app.Pool.Query(context.Background(), `SELECT c.id, c.ordinal, c.token_count, c.parent_first, c.parent_last, c.content, c.document_id::text, d.filename
FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.source_id = $1 AND c.profile_id = $2 ORDER BY d.filename, c.ordinal`, src, profile)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Close()
	var out []parentRow
	for res.Next() {
		var r parentRow
		if err := res.Scan(&r.ID, &r.Ordinal, &r.Tokens, &r.First, &r.Last, &r.Content, &r.Document, &r.File); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

// ask asks the agent a question (streaming, as the chat page does) and returns the end of the answer.
func (env *parentEnv) ask(t *testing.T, q string) apitypes.ChatEventMessageEnd {
	t.Helper()
	code, evs, e := env.member.stream(env.chatPath(env.agent.Slug), map[string]any{"message": q})
	mustCode(t, "chat", code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	return end
}

// lastSources is the text of the latest chat request the model received that carried sources: every message of it, joined.
func (env *parentEnv) lastSources(t *testing.T) string { return lastSources(t, env.proxy) }

func lastSources(t *testing.T, p *testutil.FakeProxy) string {
	t.Helper()
	reqs := p.ChatRequests()
	for i := len(reqs) - 1; i >= 0; i-- {
		var body struct {
			Messages []struct {
				Content any `json:"content"`
			} `json:"messages"`
		}
		if json.Unmarshal(reqs[i], &body) != nil {
			continue
		}
		var all []string
		for _, m := range body.Messages {
			switch c := m.Content.(type) {
			case string:
				all = append(all, c)
			default:
				raw, _ := json.Marshal(c)
				all = append(all, string(raw))
			}
		}
		if text := strings.Join(all, "\n"); strings.Contains(text, "<source id=") {
			return text
		}
	}
	t.Fatal("no chat request carried sources")
	return ""
}

// sourceBody is the text of <source id="n"> in what the model received.
func sourceBody(t *testing.T, sources string, n int) string {
	t.Helper()
	open := fmt.Sprintf(`<source id="%d"`, n)
	i := strings.Index(sources, open)
	if i < 0 {
		t.Fatalf("no source %d in %.300s", n, sources)
	}
	rest := sources[i:]
	start := strings.Index(rest, ">\n")
	end := strings.Index(rest, "\n</source>")
	if start < 0 || end < start {
		t.Fatalf("source %d is not closed in %.300s", n, rest)
	}
	return rest[start+2 : end]
}

// checkRanges fails unless the rows of one document (in ordinal order) each carry a range that contains them and is made of rows that carry the
// same range: ranges tile the document with no gap and no overlap.
func checkRanges(t *testing.T, rows []parentRow) {
	t.Helper()
	for i, r := range rows {
		if r.First == nil || r.Last == nil || *r.First > r.Ordinal || r.Ordinal > *r.Last || int(*r.Last) >= len(rows) {
			t.Fatalf("passage %d has range %v-%v of %d passages", r.Ordinal, r.First, r.Last, len(rows))
		}
		for _, k := range rows[*r.First : *r.Last+1] {
			if *k.First != *r.First || *k.Last != *r.Last {
				t.Fatalf("passages %d and %d are in one range but record %d-%d and %d-%d", r.Ordinal, k.Ordinal, *r.First, *r.Last, *k.First, *k.Last)
			}
		}
		if i > 0 && *r.First != *rows[i-1].First && *r.First != rows[i-1].Ordinal+1 {
			t.Fatalf("ranges %d-%d and %d-%d overlap or leave a gap", *rows[i-1].First, *rows[i-1].Last, *r.First, *r.Last)
		}
	}
}
