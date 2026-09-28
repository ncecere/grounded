package breakglass

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func TestSummaryLines(t *testing.T) {
	got := SummaryLines([]dbgen.BreakGlassReadCountsRow{
		{Kind: ReadPassages, Reads: 2, Targets: 1},
		{Kind: ReadConversation, Reads: 5, Targets: 3},
		{Kind: ReadConversationList, Reads: 1, Targets: 1},
		{Kind: ReadSourceList, Reads: 4, Targets: 1},
		{Kind: "unknown", Reads: 9, Targets: 9},
	})
	want := []string{
		"- Conversation list: viewed once",
		"- Conversation transcripts: 3 conversations (5 reads)",
		"- Data source list: viewed 4 times",
		"- Document passages: 1 document (2 reads)",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("summary =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	if SummaryLines(nil) != nil {
		t.Error("empty summary should be nil")
	}
}

func TestReadScope(t *testing.T) {
	for kind, want := range map[string]string{
		ReadConversationList: authz.BreakGlassConversations, ReadConversation: authz.BreakGlassConversations,
		ReadSourceList: authz.BreakGlassDocuments, ReadDocument: authz.BreakGlassDocuments, ReadPassages: authz.BreakGlassDocuments,
		ReadBoilerplate: authz.BreakGlassDocuments, ReadCrawls: authz.BreakGlassDocuments,
	} {
		if got := (Read{Kind: kind}).scope(); got != want {
			t.Errorf("%s scope = %s, want %s", kind, got, want)
		}
	}
}

// A nil service, an API key or a non-admin never gets a grant, and nothing
// is read from the database for them.
func TestAuthorizeWithoutGrant(t *testing.T) {
	var none *Service
	team := uuid.New()
	admin := authz.Actor{UserID: uuid.New(), PlatformRole: authz.PlatformAdmin}
	if g, err := none.Authorize(context.Background(), admin, team, Read{Kind: ReadDocument}); g != nil || err != nil {
		t.Errorf("nil service = %v %v", g, err)
	}
	s := &Service{} // no pool: any database access would panic
	for _, a := range []authz.Actor{
		{UserID: admin.UserID, PlatformRole: authz.PlatformAdmin, Key: &authz.KeyGrant{TeamID: team}},
		{UserID: admin.UserID, PlatformRole: authz.PlatformAuditor},
		{UserID: admin.UserID},
		{PlatformRole: authz.PlatformAdmin},
	} {
		if g, err := s.Authorize(context.Background(), a, team, Read{Kind: ReadDocument}); g != nil || err != nil {
			t.Errorf("%+v = %v %v", a, g, err)
		}
	}
}
