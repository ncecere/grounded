package mcpserver

import (
	"cmp"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

// option is one value of a tool argument's enum: the name a model sends
// (a slug), with what the tool's description says about it.
type option struct {
	ID          uuid.UUID
	Slug        string
	Name        string
	Description string
	// TeamID is the team the knowledge base or agent belongs to.
	TeamID uuid.UUID
}

// maxOptionText bounds an option's description in the tool description:
// its first line, cut at this many characters.
const maxOptionText = 200

// kbOptions names knowledge bases by a slug of their name ("Student
// handbook" → student-handbook). Names are unique in a team, but two can
// share a slug ("A & B", "A-B"); those get the start of their ID appended,
// so every slug is unique and stays the same while the names do. A person
// signed in with OAuth may work in several teams, so their names always
// start with the team's slug (it-help-desk/student-handbook): the same in
// one team or five, so joining or leaving a team renames nothing.
func kbOptions(list []KnowledgeBase) []option {
	out := make([]option, len(list))
	count := map[string]int{}
	for i, kb := range list {
		out[i] = option{ID: kb.ID, Slug: teamPrefix(kb.TeamSlug) + slugify(cmp.Or(kb.SlugName, kb.Name)), Name: kb.Name, Description: kb.Description, TeamID: kb.TeamID}
		count[out[i].Slug]++
	}
	return unique(out, count)
}

// teamPrefix is "<team-slug>/" for a person's options, "" for a key's.
func teamPrefix(teamSlug string) string {
	if teamSlug == "" {
		return ""
	}
	return teamSlug + "/"
}

// unique appends the start of their ID to slugs that are empty (or only a
// team) or shared.
func unique(out []option, count map[string]int) []option {
	for i := range out {
		s := out[i].Slug
		if s == "" || strings.HasSuffix(s, "/") || count[s] > 1 {
			sep := "-"
			if s == "" || strings.HasSuffix(s, "/") {
				sep = ""
			}
			out[i].Slug = s + sep + out[i].ID.String()[:8]
		}
	}
	return out
}

// agentOptions name agents by their slug, unique in a team; a person's
// start with the team's slug, like knowledge bases (it-help-desk/helper).
func agentOptions(list []Agent) []option {
	out := make([]option, len(list))
	count := map[string]int{}
	for i, ag := range list {
		out[i] = option{ID: ag.ID, Slug: teamPrefix(ag.TeamSlug) + ag.Slug, Name: ag.Name, Description: ag.Description, TeamID: ag.TeamID}
		count[out[i].Slug]++
	}
	return unique(out, count)
}

// maxSlug bounds a knowledge base's slug, in runes.
const maxSlug = 60

// slugify lowercases a name and joins its letters and digits with hyphens.
func slugify(name string) string {
	var out []rune
	dash := false
	for _, r := range strings.ToLower(name) {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			dash = true
			continue
		}
		if dash && len(out) > 0 {
			out = append(out, '-')
		}
		out, dash = append(out, r), false
	}
	if len(out) > maxSlug {
		out = out[:maxSlug]
	}
	return strings.TrimRight(string(out), "-")
}

func find(opts []option, slug string) (option, bool) {
	for _, o := range opts {
		if o.Slug == slug {
			return o, true
		}
	}
	return option{}, false
}

func slugs(opts []option) []any {
	out := make([]any, len(opts))
	for i, o := range opts {
		out[i] = o.Slug
	}
	return out
}

// describe lists the options for a tool description: one line each, with
// the name and the first line of the description.
func describe(opts []option) string {
	var b strings.Builder
	for _, o := range opts {
		fmt.Fprintf(&b, "\n- %s: %s", o.Slug, o.Name)
		if d := firstLine(o.Description); d != "" {
			b.WriteString(" — " + d)
		}
	}
	return b.String()
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	return truncate(s, maxOptionText)
}

// truncate cuts s to at most n runes, marking a cut with an ellipsis.
func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n-1])) + "…"
}
