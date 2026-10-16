package agents

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestShareTokens(t *testing.T) {
	token, hash, err := newShareToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(token) != shareTokenLen || len(hash) != 32 {
		t.Fatalf("token %d chars, hash %d bytes", len(token), len(hash))
	}
	if got, ok := shareTokenHash(token); !ok || string(got) != string(hash) {
		t.Error("the hash of a link's secret is not the hash that was kept")
	}
	again, _, _ := newShareToken()
	if again == token {
		t.Error("two secrets are the same")
	}
	// Text that cannot be a secret is refused before anything is looked up.
	for name, bad := range map[string]string{
		"empty": "", "short": token[:42], "long": token + "A", "not base64url": strings.Repeat("!", shareTokenLen),
		"padding": token[:42] + "=", "standard alphabet": strings.Repeat("+", shareTokenLen),
	} {
		if _, ok := shareTokenHash(bad); ok {
			t.Errorf("%s: accepted", name)
		}
	}
	// One secret, one spelling: 32 bytes fill 43 characters with two spare bits in the last, which the canonical text leaves zero, so the same
	// bytes spelled with them set are a different string that must not be accepted.
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	last := strings.IndexByte(alphabet, token[42])
	if last%4 != 0 {
		t.Fatalf("the last character of a canonical secret has its low 2 bits zero, got index %d", last)
	}
	if _, ok := shareTokenHash(token[:42] + string(alphabet[last+1])); ok {
		t.Error("a non-canonical spelling of the same bytes was accepted")
	}
}

func TestSharedMessagesShowOnlyTheConversation(t *testing.T) {
	page := int32(3)
	doc := uuid.New()
	views := []MessageView{
		{ID: uuid.New(), Seq: 1, Role: "user", Text: "How do I get a permit?", CreatedAt: time.Unix(1, 0)},
		{ID: uuid.New(), Seq: 2, Role: "assistant", Text: "At the office [1][2].", Thinking: "SECRET REASONING",
			ToolCalls: []ToolCallView{{ID: "t1", Name: "search", Query: "SECRET QUERY"}},
			Retrieval: &RetrievalView{Query: "SECRET REWRITE", HitCount: 4},
			Feedback:  ptr("down"), FeedbackReason: ptr("incorrect"), FeedbackShared: true,
			Usage: nil, Uncited: []UncitedSentence{{}}, Claims: []Claim{{Text: "SECRET CLAIM"}},
			Citations: []Citation{
				{N: 1, DocumentID: doc, SourceID: doc, Title: "Parking", Snippet: "Permits cost 120.", HeadingPath: []string{"Permits"}, PageStart: &page, URL: "https://x.example/parking",
					Verification: "verified", Markers: []MarkerVerdict{{}}},
				{N: 2, Kind: SourceTool, Server: "Status", Tool: "check", Snippet: "TOOL RESULT TEXT", URL: "https://internal.example/x"},
			}, CreatedAt: time.Unix(2, 0)},
		{ID: uuid.New(), Seq: 3, Role: "user", Text: "And after hours?", CreatedAt: time.Unix(3, 0)},
		{ID: uuid.New(), Seq: 4, Role: "assistant", Text: "LATER ANSWER, not in the snapshot", CreatedAt: time.Unix(4, 0)},
		{ID: uuid.New(), Seq: 5, Role: "tool_result", Text: "SECRET TOOL OUTPUT"},
	}
	got := sharedMessages(views, 3)
	if len(got) != 3 || got[0].Seq != 1 || got[1].Seq != 2 || got[2].Seq != 3 {
		t.Fatalf("messages = %+v: only those up to the snapshot's last", got)
	}
	raw, _ := json.Marshal(got)
	for _, leaked := range []string{"SECRET", "LATER ANSWER", "TOOL RESULT TEXT", "internal.example", "thinking", "toolCalls", "retrieval", "feedback", "uncited", "claims",
		"verification", "markers", "usage", "latencyMs", "documentId", "sourceId", "confidence"} {
		if strings.Contains(string(raw), leaked) {
			t.Errorf("a shared view carries %q: %s", leaked, raw)
		}
	}
	c := got[1].Citations
	if len(c) != 2 || c[0].Title != "Parking" || c[0].Snippet != "Permits cost 120." || c[0].URL != "https://x.example/parking" || *c[0].PageStart != 3 {
		t.Errorf("the passage citation = %+v", c[0])
	}
	if c[1].Kind != SourceTool || c[1].Server != "Status" || c[1].Tool != "check" || c[1].Snippet != "" || c[1].URL != "" {
		t.Errorf("a tool's result is named but its text is not shown: %+v", c[1])
	}
	// No citations is an empty list, never null; so are headings.
	if raw, _ := json.Marshal(got[0]); !strings.Contains(string(raw), `"citations":[]`) {
		t.Errorf("a question's citations = %s", raw)
	}
	if raw, _ := json.Marshal(sharedCitation(Citation{N: 1, Title: "x"})); !strings.Contains(string(raw), `"headingPath":[]`) {
		t.Errorf("headings = %s", raw)
	}
	if m := sharedMessages([]MessageView{{Seq: 2, Role: "assistant", StopReason: "aborted"}}, 5); !m[0].Stopped {
		t.Error("a stopped answer is not marked")
	}
}

// A share is a pointer to the first N messages, not a copy of them: that is only a snapshot while messages are never edited or removed one
// by one (they go with their conversation). If a feature ever needs to, the share has to copy what it covers first (docs/specs/v0.6.0).
func TestMessagesAreAppendOnly(t *testing.T) {
	root := filepath.Join("..", "..", "internal")
	re := regexp.MustCompile(`(?i)\b(update\s+messages\b|delete\s+from\s+messages\b)`)
	checked := 0
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasSuffix(path, "_test.go") || strings.Contains(path, "/dbgen/") {
			return err
		}
		if !strings.HasSuffix(path, ".go") && !strings.HasSuffix(path, ".sql") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		checked++
		if loc := re.FindIndex(src); loc != nil {
			t.Errorf("%s edits or removes messages (%q): a share would no longer be a snapshot", path, src[loc[0]:loc[1]])
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if checked < 100 {
		t.Fatalf("looked at only %d files", checked)
	}
}
