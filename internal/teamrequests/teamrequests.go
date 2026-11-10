// Package teamrequests is the in-app request for a team (v0.6.0, E3; docs/specs/v0.6.0/DESIGN.md "Team requests"): anyone signed in asks, platform
// admins review, and approving creates the team with the requester (or the person they named) as its owner.
//
// A platform switch (off by default) turns the whole feature on and off. Off, nobody can ask (the API refuses too) and team creation stays
// with platform admins; requests already open stay in the review queue until someone decides them.
package teamrequests

import (
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/webhooks"
)

// Statuses of a request.
const (
	StatusPending   = "pending"
	StatusApproved  = "approved"
	StatusDeclined  = "declined"
	StatusWithdrawn = "withdrawn"
)

// Why a person cannot ask right now (Mine.Blocked).
const (
	BlockedOff   = "off"
	BlockedGroup = "group"
	BlockedLimit = "limit"
)

// Service handles team requests.
type Service struct {
	Pool   *pgxpool.Pool
	Teams  *teams.Service
	Agents *agents.Service
	// Notify tells platform admins of a new request and the person who asked of the decision (nil: nobody).
	Notify *notify.Service
	// Webhooks hears of new requests (nil: nobody).
	Webhooks *webhooks.Service
	q        *dbgen.Queries
}

// New returns a Service.
func New(pool *pgxpool.Pool, t *teams.Service, a *agents.Service, n *notify.Service) *Service {
	return &Service{Pool: pool, Teams: t, Agents: a, Notify: n, q: dbgen.New(pool)}
}

var (
	errNotFound      = apperr.NotFound("request_not_found", "Request not found")
	errAdminOnly     = apperr.Forbidden("Only platform admins can decide team requests")
	errSignedInOnly  = apperr.Forbidden("Team requests are for people signing in")
	errOff           = apperr.New(403, "team_requests_off", "Team requests are not turned on: ask a platform admin for a team")
	errNotInGroup    = apperr.New(403, "not_allowed_to_request", "Your account is not allowed to request a team: ask a platform admin")
	errTooManyOpen   = apperr.Conflict("too_many_open_requests", "You already have the most open team requests allowed: wait for one to be decided, or withdraw one")
	errAlreadyClosed = apperr.Conflict("request_already_decided", "This request was already decided or withdrawn")
	// A team is never created with a suspended person as its owner: the reviewer names someone else (ApproveInput.OwnerEmail).
	errOwnerSuspended = apperr.Conflict("owner_suspended", "The account that would own this team is suspended: choose a different owner")
)
