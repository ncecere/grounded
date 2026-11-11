package sourcesync

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/access"
	"github.com/ncecere/grounded/internal/connector"
)

// Bounds on what one item or group may name. Past them the list is cut to nobody or to the first members, and a note
// says so: a truncated permission list must never read as a shorter list of people who all keep access.
const (
	maxItemPrincipals = 2000
	maxGroupMembers   = 200000
	maxGroupID        = 400
)

// storedACL is what documents.acl keeps of a connector's permissions, for display and audit. Enforcement reads
// documents.acl_principals only.
type storedACL struct {
	Origin string          `json:"origin"`
	Notes  []string        `json:"notes,omitempty"`
	Raw    json.RawMessage `json:"raw,omitempty"`
}

// resolve turns a connector's permissions into the stored list (nil: unrestricted) and the note kept beside it.
// It fails closed: a missing report, a principal that isn't well formed and a list too long to store all end as
// fewer readers, never more. A list with no usable principal is nobody.
func resolve(sourceID uuid.UUID, p *connector.Permissions) ([]string, json.RawMessage) {
	acl := storedACL{Origin: "connector"}
	if p == nil {
		acl.Notes = []string{"The connector reported no permissions for this document, so nobody can read it."}
		return []string{}, mustJSON(acl)
	}
	acl.Notes, acl.Raw = slices.Clone(p.Notes), p.Raw
	if !json.Valid(acl.Raw) {
		acl.Raw = nil
	}
	if p.Everyone {
		return nil, mustJSON(acl)
	}
	seen := map[string]bool{}
	out := []string{}
	add := func(principal string) {
		if !seen[principal] {
			seen[principal] = true
			out = append(out, principal)
		}
	}
	dropped := 0
	for _, raw := range p.Principals {
		if principal, ok := normalPrincipal(raw); ok {
			add(principal)
		} else {
			dropped++
		}
	}
	for _, g := range p.Groups {
		if g = strings.TrimSpace(g); g == "" || len(g) > maxGroupID {
			dropped++
			continue
		}
		add(access.SourceGroup(sourceID, strings.ToLower(g)))
	}
	if dropped > 0 {
		acl.Notes = append(acl.Notes, fmt.Sprintf("%d entries could not be matched to a person or group and give nobody access.", dropped))
	}
	if len(out) > maxItemPrincipals {
		acl.Notes = append(acl.Notes, fmt.Sprintf("The document is shared with more than %d people and groups, which is more than is kept, so nobody can read it. Share it with a group instead.", maxItemPrincipals))
		out = []string{}
	}
	slices.Sort(out)
	return out, mustJSON(acl)
}

// normalPrincipal checks and normalises one principal a connector reported: email:, subject:, group: or user:.
func normalPrincipal(raw string) (string, bool) {
	kind, value, ok := strings.Cut(strings.TrimSpace(raw), ":")
	kind, value = strings.ToLower(strings.TrimSpace(kind)), strings.ToLower(strings.TrimSpace(value))
	if !ok || value == "" || len(value) > 256 {
		return "", false
	}
	switch kind {
	case access.KindEmail:
		if strings.Count(value, "@") != 1 || strings.HasPrefix(value, "@") || strings.HasSuffix(value, "@") {
			return "", false
		}
	case access.KindUser:
		if _, err := uuid.Parse(value); err != nil {
			return "", false
		}
	case access.KindSubject, access.KindGroup:
	default:
		return "", false
	}
	return access.Principal(kind, value), true
}

// groupMembers normalises a connector group's members, dropping what isn't well formed.
func groupMembers(members []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, raw := range members {
		if p, ok := normalPrincipal(raw); ok && !seen[p] {
			seen[p] = true
			out = append(out, p)
			if len(out) == maxGroupMembers {
				break
			}
		}
	}
	return out
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return b
}
