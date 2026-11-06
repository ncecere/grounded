package store_test

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Document permissions (docs/specs/document-acls/DESIGN.md): passage text reaches a reader only through a query that
// checks the reader's permissions. Every query that reads chunks' content must check documents.acl_principals, or be
// listed here with why it never reaches a reader. A new query that reads passage text fails this test until it decides.
var passageTextWithoutPermissions = map[string]string{
	"DocumentChunkKeys":     "ingest: matches a document's own new chunks to its old ones when rechunking",
	"ProfileDocumentChunks": "ingest: copies a document's chunks to a new embedding profile",
	"ListViewerChunks":      "viewer: only listed for a document GetViewerDocument returned, which checks permissions",
}

func TestEveryPassageTextQueryChecksPermissions(t *testing.T) {
	files, err := filepath.Glob("queries/*.sql")
	if err != nil || len(files) == 0 {
		t.Fatalf("query files: %v %v", files, err)
	}
	block := regexp.MustCompile(`(?s)-- name: (\w+)[^\n]*\n(.*?)(?:\n-- name:|\z)`)
	// A query reads passage text when it reads the chunks table and selects a content column (content_tsv and the like
	// are other columns: \b does not end a word before "_").
	table := regexp.MustCompile(`(?i)\b(FROM|JOIN)\s+chunks\b`)
	reads := regexp.MustCompile(`(?i)\bcontent\b`)
	var missing, seen []string
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		text := string(raw)
		for i := 0; i < len(text); {
			m := block.FindStringSubmatchIndex(text[i:])
			if m == nil {
				break
			}
			name, body := text[i+m[2]:i+m[3]], text[i+m[4]:i+m[5]]
			i += m[5]
			if !table.MatchString(body) || !reads.MatchString(body) {
				continue
			}
			seen = append(seen, name)
			if _, ok := passageTextWithoutPermissions[name]; ok || strings.Contains(body, "acl_principals") {
				continue
			}
			missing = append(missing, filepath.Base(f)+": "+name)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("queries that read passage text without checking document permissions (add the check, or list the query with why "+
			"it never reaches a reader):\n  %s", strings.Join(missing, "\n  "))
	}
	for name := range passageTextWithoutPermissions {
		found := false
		for _, s := range seen {
			found = found || s == name
		}
		if !found {
			t.Errorf("%s is listed but no longer reads passage text: remove it from the list", name)
		}
	}
}
