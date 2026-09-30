package mcpserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ncecere/grounded/internal/kbs"
)

// Limits of the search tool's arguments: those of POST .../retrieve.
const (
	maxQueryChars = 4000
	maxTopK       = 50
)

// SearchInput is the search tool's arguments.
type SearchInput struct {
	KnowledgeBase string `json:"knowledge_base"`
	Query         string `json:"query"`
	TopK          int    `json:"top_k,omitempty"`
}

// Passage is one retrieved passage. N is its citation number in this result.
type Passage struct {
	N           int      `json:"n" jsonschema:"The passage's citation number in this result, for [n] markers"`
	Title       string   `json:"title" jsonschema:"The document's title"`
	HeadingPath []string `json:"heading_path" jsonschema:"The headings above the passage in the document, outermost first"`
	URL         string   `json:"url,omitempty" jsonschema:"The web page, for passages from web sources"`
	Filename    string   `json:"filename,omitempty" jsonschema:"The uploaded file, for passages from uploads"`
	PageStart   int32    `json:"page_start,omitempty" jsonschema:"The first page of the passage, for paged documents"`
	PageEnd     int32    `json:"page_end,omitempty" jsonschema:"The last page of the passage, for paged documents"`
	DocumentID  string   `json:"document_id" jsonschema:"The document's ID in Grounded"`
	Text        string   `json:"text" jsonschema:"The passage's text"`
}

// SearchResult is the search tool's structured result.
type SearchResult struct {
	KnowledgeBase string    `json:"knowledge_base" jsonschema:"The knowledge base searched"`
	Passages      []Passage `json:"passages" jsonschema:"The passages, most relevant first"`
}

var searchOutputSchema = mustSchema[SearchResult]()

func mustSchema[T any]() *jsonschema.Schema {
	s, err := jsonschema.For[T](nil)
	if err != nil {
		panic(err)
	}
	return s
}

func searchTool(opts []option) *mcp.Tool {
	in := &jsonschema.Schema{
		Type: "object",
		Properties: map[string]*jsonschema.Schema{
			"knowledge_base": {Type: "string", Enum: slugs(opts), Description: "The knowledge base to search (one of the names listed in the tool's description)"},
			"query":          {Type: "string", MinLength: jsonschema.Ptr(1), MaxLength: jsonschema.Ptr(maxQueryChars), Description: "What to look for, in plain words"},
			"top_k": {Type: "integer", Minimum: jsonschema.Ptr(1.0), Maximum: jsonschema.Ptr(float64(maxTopK)),
				Description: "How many passages to return (default: the knowledge base's own setting)"},
		},
		Required:      []string{"knowledge_base", "query"},
		PropertyOrder: []string{"knowledge_base", "query", "top_k"},
	}
	return &mcp.Tool{
		Name:  "search",
		Title: "Search a knowledge base",
		Description: "Search one of these knowledge bases and get the most relevant passages, each with its title, headings, " +
			"link and a citation number:" + describe(opts),
		InputSchema:  in,
		OutputSchema: searchOutputSchema,
		Annotations:  &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true, OpenWorldHint: jsonschema.Ptr(false)},
	}
}

// search runs the search tool: the passages as text and as structured
// content, or a tool error with the reason (a limit, a used-up budget).
func (t *toolCall) search(opts []option) mcp.ToolHandlerFor[SearchInput, SearchResult] {
	return func(ctx context.Context, _ *mcp.CallToolRequest, in SearchInput) (*mcp.CallToolResult, SearchResult, error) {
		kb, ok := find(opts, in.KnowledgeBase)
		if !ok { // the schema's enum has already refused it
			return nil, SearchResult{}, userError("Unknown knowledge base " + in.KnowledgeBase + ".")
		}
		ctx, cancel := t.bound(ctx)
		defer cancel()
		hits, err := t.s.opts.Backend.Search(ctx, t.actor(), kb.ID, in.Query, min(in.TopK, maxTopK))
		meta := map[string]any{"knowledgeBase": kb.Slug}
		if err != nil {
			outcome, code, out := t.toolError(ctx, "search", err)
			meta["outcome"], meta["error"] = outcome, code
			t.record(ctx, "search", "knowledge_base", kb.ID.String(), meta)
			return nil, SearchResult{}, out
		}
		res := SearchResult{KnowledgeBase: kb.Slug, Passages: passages(hits)}
		meta["outcome"], meta["results"] = outcomeOK, len(res.Passages)
		t.record(ctx, "search", "knowledge_base", kb.ID.String(), meta)
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: searchText(kb, res)}}}, res, nil
	}
}

func passages(hits []kbs.Hit) []Passage {
	out := make([]Passage, len(hits))
	for i, h := range hits {
		heading := h.HeadingPath
		if heading == nil {
			heading = []string{}
		}
		out[i] = Passage{N: i + 1, Title: h.Title, HeadingPath: heading, URL: h.URL, Filename: h.Filename, PageStart: h.PageStart,
			PageEnd: h.PageEnd, DocumentID: h.DocumentID.String(), Text: h.Content}
	}
	return out
}

// searchText is the passages for a model to read.
func searchText(kb option, res SearchResult) string {
	if len(res.Passages) == 0 {
		return fmt.Sprintf("No passages in %s matched the query.", kb.Name)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%d passages from %s. Cite them by their [n] numbers.", len(res.Passages), kb.Name)
	for _, p := range res.Passages {
		b.WriteString("\n\n" + sourceLine(p.N, p.Title, p.HeadingPath, p.URL, p.Filename, p.PageStart, p.PageEnd))
		b.WriteString("\n" + strings.TrimSpace(p.Text))
	}
	return b.String()
}

// sourceLine is "[n] Title › Heading (page 3) <url>".
func sourceLine(n int, title string, heading []string, url, filename string, pageStart, pageEnd int32) string {
	parts := []string{}
	if title = strings.TrimSpace(title); title != "" {
		parts = append(parts, title)
	} else if filename != "" {
		parts = append(parts, filename)
	}
	parts = append(parts, heading...)
	line := fmt.Sprintf("[%d] %s", n, strings.Join(parts, " › "))
	switch {
	case pageStart > 0 && pageEnd > pageStart:
		line += fmt.Sprintf(" (pages %d–%d)", pageStart, pageEnd)
	case pageStart > 0:
		line += fmt.Sprintf(" (page %d)", pageStart)
	}
	if url != "" {
		line += " <" + url + ">"
	}
	return line
}
