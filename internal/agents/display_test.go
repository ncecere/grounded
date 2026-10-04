package agents

import (
	"testing"

	"github.com/ncecere/grounded/internal/kbs"
)

// A snippet leaves out the headings at its start that its card shows as the
// title and heading path (US2-11), and keeps other headings and the text.
func TestHitSnippetDropsShownHeadings(t *testing.T) {
	for _, c := range []struct {
		hit  kbs.Hit
		want string
	}{
		{kbs.Hit{Title: "Borrowing", HeadingPath: []string{"Renew"}, Content: "## Renew\n\nRenew online at library.example.edu/account."}, "Renew online at library.example.edu/account."},
		{kbs.Hit{Title: "Connect to campus Wi-Fi", HeadingPath: []string{"Connect to campus Wi-Fi", "Networks"},
			Content: "# Connect to campus Wi-Fi\n## Networks\n\n| Network | Who |\n| --- | --- |\n| eduroam | Students |"}, "Network · Who eduroam · Students"},
		{kbs.Hit{Title: "Withdrawal", Content: "## Yes, I Wish to Withdraw\n\nUse the button below."}, "Yes, I Wish to Withdraw Use the button below."},
		{kbs.Hit{Title: "Planned maintenance", HeadingPath: []string{"Planned maintenance"}, Content: "# Planned maintenance\n"}, "Planned maintenance"},
		{kbs.Hit{Title: "Hours", HeadingPath: []string{"Hours"}, Content: "Hours vary in the summer."}, "Hours vary in the summer."},
	} {
		if got := hitSnippet(c.hit); got != c.want {
			t.Errorf("hitSnippet(%q) = %q, want %q", c.hit.Content, got, c.want)
		}
	}
}
