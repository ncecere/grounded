package chunk

import (
	"strings"
	"testing"
)

// A label remains a boundary when boilerplate filtering removes its list and
// the label subsequently becomes the caption of the following table.
func TestV4ReviewDroppedListKeepsCaptionBoundary(t *testing.T) {
	doc := "# Services\n\n**Alpha**\n\n- request alpha\n\n**Beta**\n\n- shared instructions\n\n| Item | Fee |\n| --- | --- |\n| request beta | 2 |"
	o := v3(200, 10)
	o.Version = Version4
	o.DropBlock = func(s string) bool { return strings.Contains(s, "shared instructions") }
	got, err := Split(doc, o)
	if err != nil {
		t.Fatal(err)
	}
	retained := strings.Replace(doc, "\n\n- shared instructions", "", 1)
	checkInvariants(t, retained, o, got)
	if len(got) != 2 {
		t.Fatalf("lost label boundary after dropping its list: %q", contents(got))
	}
	if strings.Contains(got[0].Content, "request beta") || strings.Contains(got[1].Content, "request alpha") {
		t.Fatalf("procedures mixed across caption boundary: %q", contents(got))
	}
	if len(Parents(got, 1000)) != 2 {
		t.Fatal("parent expansion reunited distinct labels")
	}
}

func TestV4ReviewMultiChildParentSections(t *testing.T) {
	doc := "# Services\n\n**Alpha**\n\n- " + strings.Repeat("alpha step details. ", 80) + "\n\n**Beta**\n\n- " + strings.Repeat("beta step details. ", 80)
	o := v3(32, 0)
	o.Version = Version4
	got := mustSplit(t, doc, o)
	parents := Parents(got, 512)
	if len(parents) < 2 || parents[0].Last == parents[0].First {
		t.Fatalf("fixture needs a multi-child parent before the next section: %+v", parents)
	}
	for _, r := range parents {
		for j := r.First; j <= r.Last; j++ {
			if got[r.First].section != got[j].section {
				t.Fatalf("parent crossed structural sections: %+v", r)
			}
		}
	}
}
