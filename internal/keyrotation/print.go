package keyrotation

import (
	"fmt"
	"io"
	"text/tabwriter"

	"github.com/ncecere/grounded/internal/secrets"
)

// printPepper writes the pepper part of a run for operators: ids, names,
// teams and last use, never digests or keys.
func printPepper(w io.Writer, p secrets.Peppers, sum Summary) {
	fmt.Fprintln(w)
	if len(p.Previous) > 0 {
		fmt.Fprintln(w, "API key pepper: API_KEY_PEPPER_PREVIOUS is set; keys on it are re-hashed with API_KEY_PEPPER when next used.")
	} else {
		fmt.Fprintln(w, "API key pepper: no API_KEY_PEPPER_PREVIOUS is set.")
	}
	if n := sum.LabelledAPIKeys + sum.LabelledPublishableKeys; n > 0 {
		fmt.Fprintf(w, "  Recorded %d key digest(s) from before pepper tracking as on the previous pepper.\n", n)
	}
	var previous, retired int
	for _, k := range sum.PepperKeys {
		if k.State == secrets.PepperPrevious {
			previous++
		} else {
			retired++
		}
	}
	if previous == 0 && retired == 0 {
		fmt.Fprintln(w, "  Every usable API key and widget key is on the current pepper.")
		return
	}
	if previous > 0 {
		fmt.Fprintf(w, "  %d key(s) are still on the previous pepper. They stop working when API_KEY_PEPPER_PREVIOUS is removed unless they are used before then.\n", previous)
	}
	if retired > 0 {
		fmt.Fprintf(w, "  %d key(s) were hashed with a pepper that is no longer configured; they cannot work and should be revoked.\n", retired)
	}
	tw := tabwriter.NewWriter(w, 2, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "  STATE\tKIND\tID\tNAME\tTEAM\tAGENT\tLAST USED")
	for _, k := range sum.PepperKeys {
		last := "never"
		if k.LastUsedAt != nil {
			last = k.LastUsedAt.UTC().Format("2006-01-02 15:04Z")
		}
		agent := k.AgentName
		if agent == "" {
			agent = "-"
		}
		fmt.Fprintf(tw, "  %s\t%s\t%s\t%s\t%s\t%s\t%s\n", k.State, k.Kind, k.ID, k.Name, k.TeamSlug, agent, last)
	}
	_ = tw.Flush()
}
