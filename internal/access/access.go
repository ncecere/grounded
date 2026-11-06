// Package access decides whose permissions a read of document text is made with (B6, #41;
// docs/specs/document-acls/DESIGN.md).
//
// A document is unrestricted (acl_principals NULL) or restricted to a list of principals: namespaced, lower-case strings
// (user:, subject:, email:, group:, source:). A caller is either Anyone, with no principals, which reads unrestricted
// documents only, or a Person with theirs. Only a person at the app, or their own connected app on MCP, is a Person: an API
// key, an anonymous visitor, an evaluation run and background work are Anyone. The zero Caller is undecided, and every read
// of text refuses it (ErrNoCaller), so a new call site cannot leak by forgetting to decide.
package access

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ErrNoCaller is a read of document text with no decision about whose permissions apply. It is a programming error.
var ErrNoCaller = errors.New("access: read of document text without a caller")

// Principal kinds.
const (
	KindUser    = "user"
	KindSubject = "subject"
	KindEmail   = "email"
	KindGroup   = "group"
	KindSource  = "source"
)

// Principal is a normalised principal string: kind:value, value trimmed and lower-cased.
func Principal(kind, value string) string {
	return kind + ":" + strings.ToLower(strings.TrimSpace(value))
}

// SourceGroup is a connector's own group, expanded to members by the connector (source_group_members).
func SourceGroup(sourceID uuid.UUID, groupID string) string {
	return Principal(KindSource, sourceID.String()+":"+groupID)
}

// Caller is whose permissions a read is made with.
type Caller struct {
	set        bool
	person     bool
	principals []string
}

// Anyone reads unrestricted documents only.
func Anyone() Caller { return Caller{set: true, principals: []string{}} }

// Person reads unrestricted documents and those restricted to any of the principals.
func Person(principals []string) Caller {
	p := slices.Clone(principals)
	slices.Sort(p)
	return Caller{set: true, person: true, principals: slices.Compact(p)}
}

// Set reports whether whose permissions apply was decided.
func (c Caller) Set() bool { return c.set }

// IsPerson reports a person's permissions (not Anyone).
func (c Caller) IsPerson() bool { return c.person }

// Principals are the caller's principals (empty for Anyone; never nil once set).
func (c Caller) Principals() []string {
	if c.principals == nil {
		return []string{}
	}
	return c.principals
}

// Allows reports whether the caller may read a document with these permissions (nil: unrestricted). An undecided
// caller is allowed nothing.
func (c Caller) Allows(acl []string) bool {
	if !c.set {
		return false
	}
	if acl == nil {
		return true
	}
	for _, p := range acl {
		if _, found := slices.BinarySearch(c.principals, p); found {
			return true
		}
	}
	return false
}

// Resolver computes a person's principals from the database, per request (never cached: a change applies at once).
type Resolver struct {
	Q *dbgen.Queries
	// MatchClaim is SCIM_MATCH_CLAIM: the sign-in claim equal to a SCIM user's externalId (sub, or oid for Entra ID). Its
	// value is a subject principal, so a connector can name people by the identity provider's object ID.
	MatchClaim string
}

// For is the caller for an actor: a person for a signed-in session or their own OAuth connection (MCP); Anyone for an
// API key or no user.
func (r Resolver) For(ctx context.Context, a authz.Actor) (Caller, error) {
	if a.Key != nil || a.UserID == uuid.Nil {
		return Anyone(), nil
	}
	return r.ForUser(ctx, a.UserID)
}

// ForUser is a person's caller; a suspended or unknown person is Anyone.
func (r Resolver) ForUser(ctx context.Context, userID uuid.UUID) (Caller, error) {
	id, err := r.Q.CallerIdentity(ctx, userID)
	if err != nil {
		return Caller{}, fmt.Errorf("access: identity: %w", err)
	}
	if id.Status != "active" {
		return Anyone(), nil
	}
	base := identityPrincipals(userID, id, r.MatchClaim)
	groups, err := r.Q.SourceGroupsOf(ctx, base)
	if err != nil {
		return Caller{}, fmt.Errorf("access: connector groups: %w", err)
	}
	for _, g := range groups {
		base = append(base, SourceGroup(g.SourceID, g.GroupID))
	}
	return Person(base), nil
}

func identityPrincipals(userID uuid.UUID, id dbgen.CallerIdentityRow, matchClaim string) []string {
	var claims map[string]any
	_ = json.Unmarshal(id.Claims, &claims)
	out := []string{Principal(KindUser, userID.String())}
	add := func(kind, v string) {
		if strings.TrimSpace(v) != "" {
			out = append(out, Principal(kind, v))
		}
	}
	if !strings.HasPrefix(id.OIDCSubject, "scim-pending:") {
		add(KindSubject, id.OIDCSubject)
	}
	if id.ScimExternalID != nil {
		add(KindSubject, *id.ScimExternalID)
	}
	if matchClaim != "" {
		if v, ok := claims[matchClaim].(string); ok {
			add(KindSubject, v)
		}
	}
	if verified(claims["email_verified"]) || id.ScimExternalID != nil {
		add(KindEmail, id.Email)
	}
	for _, g := range id.SsoGroups {
		add(KindGroup, g)
	}
	for _, g := range id.ScimGroups {
		add(KindGroup, g)
	}
	return out
}

// verified reads an email_verified claim: true, or "true" as some identity providers send it.
func verified(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return strings.EqualFold(x, "true")
	}
	return false
}
