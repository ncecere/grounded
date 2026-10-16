package agents

import (
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

func TestSortAndCapKeepsTheFirstByNameAndCountsAll(t *testing.T) {
	var cards []Card
	for i := range MaxRouteCandidates + 3 {
		cards = append(cards, Card{Agent: dbgen.Agent{ID: uuid.New(), Name: fmt.Sprintf("agent %02d", MaxRouteCandidates+2-i)}})
	}
	got, n := sortAndCap(cards, MaxRouteCandidates)
	if n != MaxRouteCandidates+3 || len(got) != MaxRouteCandidates {
		t.Fatalf("kept %d of %d, want %d of %d", len(got), n, MaxRouteCandidates, MaxRouteCandidates+3)
	}
	if got[0].Agent.Name != "agent 00" || got[len(got)-1].Agent.Name != fmt.Sprintf("agent %02d", MaxRouteCandidates-1) {
		t.Errorf("first %q, last %q: not the first by name", got[0].Agent.Name, got[len(got)-1].Agent.Name)
	}
	// Names that differ only by case sort together, and equal names by ID, so the order never changes between requests.
	a, b := uuid.MustParse("00000000-0000-0000-0000-000000000002"), uuid.MustParse("00000000-0000-0000-0000-000000000001")
	same, _ := sortAndCap([]Card{{Agent: dbgen.Agent{ID: a, Name: "Help"}}, {Agent: dbgen.Agent{ID: b, Name: "help"}}}, 5)
	if same[0].Agent.ID != b {
		t.Errorf("equal names are ordered by ID: got %s first", same[0].Agent.ID)
	}
}
