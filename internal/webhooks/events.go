// Webhooks (v0.6.0, F3; docs/specs/v0.6.0/DESIGN.md §5): signed, retried events for other systems.
//
// An event is recorded in the transaction that made the change, with one delivery per webhook it reaches; a River job sends each delivery. A
// webhook receives only its own scope's events: a team's webhooks that team's, the platform's the platform's.

package webhooks

import (
	"time"

	"github.com/google/uuid"
)

// Scope says whose events a type is.
type Scope string

const (
	ScopeTeam     Scope = "team"
	ScopePlatform Scope = "platform"
)

// Event types.
const (
	EventSourceSynced       = "source.synced"
	EventSourceSyncFailed   = "source.sync_failed"
	EventAgentPublished     = "agent.published"
	EventFeedbackSubmitted  = "feedback.submitted"
	EventTeamCreated        = "team.created"
	EventTeamRequestCreated = "team_request.created"
	EventTest               = "webhook.test"
)

// Limits.
const (
	maxWebhooksPerScope      = 10 // per team, and for the platform
	maxDescriptionLength     = 200
	maxURLLength             = 2048
	deliveryRetentionDays    = 14
	pauseAfterFailedDelivery = 5 // deliveries that gave up in a row before a webhook pauses
)

// EventType describes an event a webhook can subscribe to.
type EventType struct {
	Type        string `json:"type"`
	Scope       Scope  `json:"scope"`
	Description string `json:"description"`
	// Test: sent on request, never subscribed to.
	Test bool `json:"-"`
}

// Catalog is every event type, in the order the UI lists them.
var Catalog = []EventType{
	{Type: EventSourceSynced, Scope: ScopeTeam, Description: "A web source finished syncing: how many pages were fetched, changed and removed"},
	{Type: EventSourceSyncFailed, Scope: ScopeTeam, Description: "A web source's sync failed: a short reason"},
	{Type: EventAgentPublished, Scope: ScopeTeam, Description: "An agent was published: the agent, the version and its audience"},
	{Type: EventFeedbackSubmitted, Scope: ScopeTeam, Description: "Someone rated an answer: the agent, the message, the rating and the reason, never the question, the answer or who"},
	{Type: EventTeamCreated, Scope: ScopePlatform, Description: "A team was created: its name, address and classification"},
	{Type: EventTeamRequestCreated, Scope: ScopePlatform, Description: "Someone asked for a team: the request and its classification, never its purpose"},
	{Type: EventTest, Scope: "", Description: "A test event, sent when you ask for one", Test: true},
}

// Lookup finds an event type.
func Lookup(t string) (EventType, bool) {
	for _, e := range Catalog {
		if e.Type == t {
			return e, true
		}
	}
	return EventType{}, false
}

// Event is what happened, as the code that made it describes it. TeamID is uuid.Nil for a platform event.
type Event struct {
	Type   string
	TeamID uuid.UUID
	Data   map[string]any
}

// TeamRef names a team in a payload.
type TeamRef struct {
	ID   uuid.UUID `json:"id"`
	Slug string    `json:"slug"`
	Name string    `json:"name"`
}

// Envelope is the body of a delivery: the same event ID for every delivery of one event, and for a redelivery.
type Envelope struct {
	ID        uuid.UUID      `json:"id"`
	Type      string         `json:"type"`
	CreatedAt time.Time      `json:"createdAt"`
	Team      *TeamRef       `json:"team,omitempty"`
	Data      map[string]any `json:"data"`
}
