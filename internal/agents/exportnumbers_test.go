package agents

import (
	"slices"
	"strings"
	"testing"
	"time"
)

// TestExportNumbers (v0.4.2 US-03): an export numbers sources as the chat
// shows them, by first citation, in the text, the list and the claims.
func TestExportNumbers(t *testing.T) {
	text := "Use eduroam [2]. Students, faculty and staff [1][2]. Guests use the portal [4]. Not a marker: a[3]."
	m := MessageView{Role: "assistant", Text: text,
		Citations: []Citation{{N: 1, Title: "Accounts"}, {N: 2, Title: "Eduroam"}, {N: 4, Title: "Guests"}},
		Uncited:   []UncitedSentence{{Start: strings.Index(text, "Not"), End: len(text)}},
		Claims:    []Claim{{Start: strings.Index(text, "Guests"), End: strings.Index(text, "[4]") + 3, Sources: []int{4}, Checks: []ClaimCheck{{N: 4, Verification: "supported"}}}}}
	v := ExportNumbers(ConversationView{Messages: []MessageView{{Role: "user", Text: "How [2]?"}, m}})
	got := v.Messages[1]
	want := "Use eduroam [1]. Students, faculty and staff [2][1]. Guests use the portal [3]. Not a marker: a[3]."
	if got.Text != want || v.Messages[0].Text != "How [2]?" {
		t.Fatalf("text = %q", got.Text)
	}
	var order []string
	for _, c := range got.Citations {
		order = append(order, c.Title)
	}
	if !slices.Equal(order, []string{"Eduroam", "Accounts", "Guests"}) || got.Citations[2].N != 3 {
		t.Fatalf("sources = %+v", got.Citations)
	}
	runes := []rune(got.Text)
	if c := got.Claims[0]; string(runes[c.Start:c.End]) != "Guests use the portal [3]" || c.Sources[0] != 3 || c.Checks[0].N != 3 {
		t.Fatalf("claim = %+v %q", c, string(runes[c.Start:c.End]))
	}
	if u := got.Uncited[0]; string(runes[u.Start:u.End]) != "Not a marker: a[3]." {
		t.Fatalf("uncited = %q", string(runes[u.Start:u.End]))
	}
	if m.Text != text || m.Citations[0].N != 1 {
		t.Fatal("the stored view changed")
	}
	md := ExportMarkdown(v, time.UTC)
	if !strings.Contains(md, "1. Eduroam") || !strings.Contains(md, "3. Guests") || !strings.Contains(md, "portal [3]") {
		t.Fatalf("markdown = %s", md)
	}
}

func TestExportMarkdownZone(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("no tzdata")
	}
	at := time.Date(2026, 10, 4, 14, 1, 0, 0, time.UTC)
	md := ExportMarkdown(ConversationView{Messages: []MessageView{{Role: "user", Text: "Hi", CreatedAt: at}}}, ny)
	if !strings.Contains(md, "(2026-10-04 10:01 EDT)") {
		t.Fatalf("markdown = %s", md)
	}
}
