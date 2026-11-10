package agents

import (
	"fmt"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/llm"
)

// ExportMarkdown renders a conversation as Markdown with its citations, its
// times in the reader's zone.
func ExportMarkdown(v ConversationView, loc *time.Location) string {
	var b strings.Builder
	title := v.Conversation.Title
	if title == "" {
		title = "Conversation"
	}
	fmt.Fprintf(&b, "# %s\n\n", title)
	fmt.Fprintf(&b, "- Agent: %s (%s/%s)\n", v.Agent.Name, v.TeamSlug, v.Agent.Slug)
	fmt.Fprintf(&b, "- Started: %s\n", v.Conversation.CreatedAt.In(loc).Format(time.RFC3339))
	fmt.Fprintf(&b, "- Exported: %s\n\n", time.Now().In(loc).Format(time.RFC3339))
	for _, m := range v.Messages {
		who := "You"
		if m.Role == "assistant" {
			who = v.Agent.Name
		}
		fmt.Fprintf(&b, "## %s (%s)\n\n", who, m.CreatedAt.In(loc).Format("2006-01-02 15:04 MST"))
		if line := answeredBy(m.RoutedTo); line != "" {
			b.WriteString(line + "\n\n")
		}
		text := strings.TrimSpace(m.Text)
		switch {
		case text != "":
			b.WriteString(text + "\n\n")
		case m.ErrorCode != "":
			fmt.Fprintf(&b, "_No answer (%s)._\n\n", m.ErrorCode)
		case m.StopReason == string(llm.StopReasonAborted):
			b.WriteString("_Stopped before answering._\n\n")
		}
		if len(m.Citations) > 0 {
			b.WriteString("Sources:\n\n")
			for _, c := range m.Citations {
				fmt.Fprintf(&b, "%d. %s", c.N, c.Title)
				if len(c.HeadingPath) > 0 {
					fmt.Fprintf(&b, " — %s", strings.Join(c.HeadingPath, " › "))
				}
				if c.PageStart != nil && *c.PageStart > 0 {
					fmt.Fprintf(&b, ", p. %d", *c.PageStart)
				}
				if c.URL != "" {
					fmt.Fprintf(&b, " <%s>", c.URL)
				}
				b.WriteString("\n")
				if c.Snippet != "" {
					fmt.Fprintf(&b, "   > %s\n", c.Snippet)
				}
			}
			b.WriteString("\n")
		}
	}
	return b.String()
}

// answeredBy is the line an export puts under a routed answer, saying which agent answered (the chat's "Answered by Agent · Team"): a
// router's own heading names the router, and without this nobody reading the export could tell who wrote the answer.
func answeredBy(r *RoutedView) string {
	if r == nil || r.Name == "" {
		return ""
	}
	line := "_Answered by " + r.Name
	if team := firstNonEmpty(r.TeamName, r.TeamSlug); team != "" {
		line += " · " + team
	}
	if r.Gone {
		line += " (no longer available)"
	}
	return line + "_"
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if s != "" {
			return s
		}
	}
	return ""
}
