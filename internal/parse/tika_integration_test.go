package parse

import (
	"context"
	"os"
	"testing"
	"time"
)

// Runs against a real Apache Tika server when GROUNDED_TEST_TIKA_URL is set
// (docker compose --profile tika up -d; GROUNDED_TEST_TIKA_URL=http://127.0.0.1:59998).
func TestTikaServer(t *testing.T) {
	url := os.Getenv("GROUNDED_TEST_TIKA_URL")
	if url == "" {
		t.Skip("GROUNDED_TEST_TIKA_URL not set")
	}
	tk := NewTika(url, time.Minute, Limits{})
	ctx := context.Background()
	if err := tk.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	pdf := pdfFile(t, "Tika Test", [][]pdfText{{{18, 700, "Housing"}, {11, 670, "Apply for housing early."}}, {{11, 700, "Second page."}}})
	doc, err := tk.Parse(ctx, Input{Name: "t.pdf", Kind: KindPDF, Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Pages != 2 || doc.Parser != "tika" {
		t.Errorf("doc = %+v", doc)
	}
	contains(t, doc.Markdown, PageMarker(1), "Apply for housing early.", PageMarker(2), "Second page.")

	docx := docxFile(t, wPara("Heading1", "Parking")+wPara("", "Permits are required."), "")
	doc, err = tk.Parse(ctx, Input{Name: "t.docx", Kind: KindDOCX, Data: docx})
	if err != nil {
		t.Fatal(err)
	}
	contains(t, doc.Markdown, "Parking", "Permits are required.")

	// The router falls back to Tika when the built-in parser fails.
	r := &Router{Builtin: &fakeParser{name: "builtin", err: ErrCorrupt}, Tika: tk}
	doc, err = r.Parse(ctx, Input{Name: "t.pdf", Kind: KindPDF, Data: pdf})
	if err != nil || doc.Parser != "tika" {
		t.Fatalf("fallback: %+v %v", doc, err)
	}
}
