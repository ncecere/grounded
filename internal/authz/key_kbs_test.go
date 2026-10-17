package authz

import (
	"testing"

	"github.com/google/uuid"
)

// A key limited to knowledge bases reaches those and no others, and being limited to none at all is not being unlimited (QA pass v0.6.0, #111).
func TestKeyKnowledgeBaseLimits(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	for _, tc := range []struct {
		name    string
		k       KeyGrant
		limited bool
		allows  map[uuid.UUID]bool
	}{
		{"unlimited", KeyGrant{}, false, map[uuid.UUID]bool{a: true, b: true}},
		{"some knowledge bases", KeyGrant{KBIDs: []uuid.UUID{a}}, true, map[uuid.UUID]bool{a: true, b: false}},
		{"limited to none (an agent that answers from nothing)", KeyGrant{KBLimited: true}, true, map[uuid.UUID]bool{a: false, b: false}},
		{"limited and some", KeyGrant{KBLimited: true, KBIDs: []uuid.UUID{b}}, true, map[uuid.UUID]bool{a: false, b: true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.k.KBsLimited(); got != tc.limited {
				t.Errorf("KBsLimited = %v, want %v", got, tc.limited)
			}
			for id, want := range tc.allows {
				if got := tc.k.AllowsKB(id); got != want {
					t.Errorf("AllowsKB(%s) = %v, want %v", id, got, want)
				}
			}
		})
	}
}
