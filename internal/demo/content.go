package demo

import "github.com/ncecere/grounded/internal/authz"

// The demo content (docs/phase5-deploy.md §5 F6 and §9 decision 5): a team,
// a web source over the Go documentation, a knowledge base and two agents.
// Objects are found again by these names and slugs, so a second run adds
// only what is missing.
const (
	// DefaultSiteURL is the crawl seed. Tests point the demo at a local site.
	DefaultSiteURL = "https://go.dev/doc/"

	TeamSlug        = "demo"
	teamName        = "Demo"
	teamDescription = "A sample team created by `grounded demo`: a web source over the Go documentation, " +
		"a knowledge base and two agents. Change or delete it like any other team."

	sourceName        = "Go documentation"
	sourceDescription = "The Go documentation under /doc/ (about 100 pages), crawled weekly."
	// sourcePrefix keeps the crawl inside the documentation.
	sourcePrefix   = "/doc/"
	sourceDepth    = 2
	sourceMaxPages = 100

	kbName        = "Go documentation"
	kbDescription = "Everything the Go documentation source crawled."

	// markerKey records in bootstrap_state which team the demo created.
	markerKey = "demo_seed"
)

// agentSpec describes one demo agent.
type agentSpec struct {
	Slug, Name, Description, Audience, Welcome string
	Starters                                   []string
}

const instructions = `You help people learn and use the Go programming language, using the Go documentation.
- Answer in plain language, and include short code examples when they help.
- When the documentation describes several ways to do something, say which one it recommends.
- If a question is about something other than Go, say that you can only help with Go.`

var starters = []string{
	"How do I install Go?",
	"How do I create a new module?",
	"How do I write and run tests?",
	"What is the difference between a slice and an array?",
}

var agentSpecs = []agentSpec{
	{
		Slug: "go-docs", Name: "Go docs assistant", Audience: authz.AudienceTeam,
		Description: "Answers questions about Go from the Go documentation. For members of the Demo team.",
		Welcome:     "Hi! I answer questions about the Go programming language, citing the Go documentation. What would you like to know?",
		Starters:    starters,
	},
	{
		Slug: "go-docs-signed-in", Name: "Go docs (signed-in)", Audience: authz.AudienceAllAuthenticated,
		Description: "The same assistant, shared with everyone who can sign in to this Grounded.",
		Welcome:     "Hi! Ask me anything about Go. My answers come from the Go documentation, with links to the pages I used.",
		Starters:    starters[:3],
	},
}
