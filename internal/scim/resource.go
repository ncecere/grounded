// Package scim is SCIM 2.0 provisioning (RFC 7643/7644; E4, #35; docs/specs/scim/DESIGN.md): the identity provider
// creates, updates and suspends users, and its groups feed the SSO group → team rules. A SCIM user is matched to a sign-in
// by its externalId (the identity provider's object ID), never by email.
package scim

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Schema URNs.
const (
	SchemaUser         = "urn:ietf:params:scim:schemas:core:2.0:User"
	SchemaGroup        = "urn:ietf:params:scim:schemas:core:2.0:Group"
	SchemaList         = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
	SchemaPatch        = "urn:ietf:params:scim:api:messages:2.0:PatchOp"
	SchemaError        = "urn:ietf:params:scim:api:messages:2.0:Error"
	SchemaSPConfig     = "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"
	SchemaResourceType = "urn:ietf:params:scim:schemas:core:2.0:ResourceType"
	SchemaSchema       = "urn:ietf:params:scim:schemas:core:2.0:Schema"
)

// Bounds (docs/specs/scim/DESIGN.md, "Bounds").
const (
	MaxPage       = 100
	MaxMembers    = 10000
	MaxBodyBytes  = 1 << 20
	maxNameLength = 256
	maxEmail      = 320
	MaxTokens     = 10
	pendingPrefix = "scim-pending:"
)

// Error is a SCIM error response (RFC 7644 §3.12).
type Error struct {
	Status int
	Type   string // scimType: invalidFilter, invalidValue, uniqueness, mutability, noTarget, invalidSyntax, tooMany
	Detail string
}

func (e *Error) Error() string { return e.Detail }

func invalid(detail string, args ...any) *Error {
	return &Error{Status: http.StatusBadRequest, Type: "invalidValue", Detail: fmt.Sprintf(detail, args...)}
}

func notFound(what string) *Error {
	return &Error{Status: http.StatusNotFound, Detail: what + " not found"}
}

// Name is a user's name (only formatted is kept; given and family names make the display name).
type Name struct {
	Formatted  string `json:"formatted,omitempty"`
	GivenName  string `json:"givenName,omitempty"`
	FamilyName string `json:"familyName,omitempty"`
}

// Email is one of a user's addresses; Grounded keeps one.
type Email struct {
	Value   string `json:"value"`
	Type    string `json:"type,omitempty"`
	Primary bool   `json:"primary,omitempty"`
}

// Meta is a resource's metadata.
type Meta struct {
	ResourceType string    `json:"resourceType"`
	Created      time.Time `json:"created"`
	LastModified time.Time `json:"lastModified"`
	Location     string    `json:"location"`
	Version      string    `json:"version"`
}

// User is the SCIM view of a Grounded user.
type User struct {
	Schemas     []string `json:"schemas"`
	ID          string   `json:"id"`
	ExternalID  string   `json:"externalId"`
	UserName    string   `json:"userName"`
	Name        Name     `json:"name"`
	DisplayName string   `json:"displayName"`
	Emails      []Email  `json:"emails"`
	Active      bool     `json:"active"`
	Meta        Meta     `json:"meta"`
}

// Member is a group member.
type Member struct {
	Value   string `json:"value"`
	Display string `json:"display,omitempty"`
	Ref     string `json:"$ref,omitempty"`
}

// Group is a SCIM group.
type Group struct {
	Schemas     []string  `json:"schemas"`
	ID          string    `json:"id"`
	ExternalID  string    `json:"externalId,omitempty"`
	DisplayName string    `json:"displayName"`
	Members     *[]Member `json:"members,omitempty"`
	Meta        Meta      `json:"meta"`
}

// ListResponse is a page of resources.
type ListResponse struct {
	Schemas      []string `json:"schemas"`
	TotalResults int64    `json:"totalResults"`
	StartIndex   int      `json:"startIndex"`
	ItemsPerPage int      `json:"itemsPerPage"`
	Resources    []any    `json:"Resources"`
}

func List(total int64, start int, items []any) ListResponse {
	if items == nil {
		items = []any{}
	}
	return ListResponse{Schemas: []string{SchemaList}, TotalResults: total, StartIndex: start, ItemsPerPage: len(items), Resources: items}
}

func version(rev int64) string { return fmt.Sprintf(`W/"%d"`, rev) }

// ToUser is a user as SCIM shows it.
func ToUser(base string, u dbgen.User) User {
	ext := ""
	if u.ScimExternalID != nil {
		ext = *u.ScimExternalID
	}
	return User{
		Schemas: []string{SchemaUser}, ID: u.ID.String(), ExternalID: ext, UserName: u.ScimUserName,
		Name: Name{Formatted: u.DisplayName}, DisplayName: u.DisplayName,
		Emails: []Email{{Value: string(u.Email), Type: "work", Primary: true}}, Active: u.Status == "active",
		Meta: Meta{ResourceType: "User", Created: u.CreatedAt, LastModified: u.UpdatedAt, Location: base + "/Users/" + u.ID.String(), Version: version(u.Revision)},
	}
}

// ToGroup is a group as SCIM shows it; members nil leaves them out (excludedAttributes=members).
func ToGroup(base string, g dbgen.ScimGroup, members []dbgen.ListSCIMGroupMembersRow) Group {
	out := Group{
		Schemas: []string{SchemaGroup}, ID: g.ID.String(), DisplayName: g.DisplayName,
		Meta: Meta{ResourceType: "Group", Created: g.CreatedAt, LastModified: g.UpdatedAt, Location: base + "/Groups/" + g.ID.String(), Version: version(g.Revision)},
	}
	if g.ExternalID != nil {
		out.ExternalID = *g.ExternalID
	}
	if members != nil {
		ms := make([]Member, len(members))
		for i, m := range members {
			ms[i] = Member{Value: m.ID.String(), Display: m.DisplayName, Ref: base + "/Users/" + m.ID.String()}
		}
		out.Members = &ms
	}
	return out
}

// userInput is what a POST, PUT or PATCH sets on a user.
type userInput struct {
	UserName, ExternalID, DisplayName, Email string
	Name                                     Name
	Active                                   bool
}

// display is the name Grounded shows: displayName, else name.formatted, else given and family names, else userName.
func (in userInput) display() string {
	for _, s := range []string{in.DisplayName, in.Name.Formatted, strings.TrimSpace(in.Name.GivenName + " " + in.Name.FamilyName)} {
		if s = strings.TrimSpace(s); s != "" {
			return s
		}
	}
	return in.UserName
}

// address is the email Grounded keeps: the one given, else userName when it is an address.
func (in userInput) address() string {
	if e := strings.TrimSpace(in.Email); e != "" {
		return strings.ToLower(e)
	}
	if strings.Contains(in.UserName, "@") {
		return strings.ToLower(strings.TrimSpace(in.UserName))
	}
	return ""
}

func (in userInput) check() *Error {
	switch {
	case strings.TrimSpace(in.UserName) == "" || len(in.UserName) > maxNameLength:
		return invalid("userName is required (at most %d characters)", maxNameLength)
	case strings.TrimSpace(in.ExternalID) == "" || len(in.ExternalID) > maxNameLength:
		return invalid("externalId is required: the identity provider's object ID, which links the user to their sign-in")
	case in.address() == "" || len(in.address()) > maxEmail || !strings.Contains(in.address(), "@"):
		return invalid("an email address is required (emails, or a userName that is an address)")
	case len(in.display()) > maxNameLength:
		return invalid("displayName is too long (at most %d characters)", maxNameLength)
	}
	return nil
}

func parseID(s string) (uuid.UUID, bool) {
	id, err := uuid.Parse(s)
	return id, err == nil
}
