package scim

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/ssogroups"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var errGroupTaken = &Error{Status: http.StatusConflict, Type: "uniqueness", Detail: "another group has this displayName or externalId"}

// groupTx runs a group change; a unique violation (name or external ID) is a uniqueness error.
func (s *Service) groupTx(ctx context.Context, fn func(q *dbgen.Queries) error) error {
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error { return fn(q) })
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		return errGroupTaken
	}
	return err
}

func checkGroupName(name string) *Error {
	if n := strings.TrimSpace(name); n == "" || len(n) > maxNameLength {
		return invalid("displayName is required (at most %d characters)", maxNameLength)
	}
	return nil
}

func optional(s *string) *string {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil
	}
	v := strings.TrimSpace(*s)
	return &v
}

// resolveMembers turns member values into the IDs of SCIM-linked users; any other value is invalidValue.
func resolveMembers(ctx context.Context, q *dbgen.Queries, values []string) ([]uuid.UUID, error) {
	if len(values) == 0 {
		return nil, nil
	}
	if len(values) > MaxMembers {
		return nil, &Error{Status: http.StatusBadRequest, Type: "invalidValue", Detail: "a group has at most 10,000 members"}
	}
	ids := make([]uuid.UUID, 0, len(values))
	for _, v := range values {
		id, ok := parseID(v)
		if !ok {
			return nil, invalid("member %q is not a user this service provisioned", v)
		}
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	linked, err := q.CountLinkedUsers(ctx, ids)
	if err != nil {
		return nil, err
	}
	if len(linked) != len(ids) {
		return nil, invalid("%d of the members are not users this service provisioned", len(ids)-len(linked))
	}
	return ids, nil
}

// membersChange adds and removes members, re-applies the SSO rules for everyone affected and audits the change.
type membersChange struct {
	add, remove []uuid.UUID
	resyncAll   bool // the name or external ID changed: every member's groups changed
}

func (s *Service) applyMembers(ctx context.Context, q *dbgen.Queries, o Origin, g dbgen.ScimGroup, c membersChange, action string, before map[string]any) error {
	if len(c.add) > 0 {
		cur, err := q.ListSCIMGroupMemberIDs(ctx, g.ID)
		if err != nil {
			return err
		}
		if len(cur)+len(c.add) > MaxMembers {
			return &Error{Status: http.StatusBadRequest, Type: "invalidValue", Detail: "a group has at most 10,000 members"}
		}
		if _, err := q.AddSCIMGroupMembers(ctx, dbgen.AddSCIMGroupMembersParams{GroupID: g.ID, UserIds: c.add}); err != nil {
			return err
		}
	}
	if len(c.remove) > 0 {
		if _, err := q.RemoveSCIMGroupMembers(ctx, dbgen.RemoveSCIMGroupMembersParams{GroupID: g.ID, UserIds: c.remove}); err != nil {
			return err
		}
	}
	affected := append(append([]uuid.UUID{}, c.add...), c.remove...)
	if c.resyncAll {
		cur, err := q.ListSCIMGroupMemberIDs(ctx, g.ID)
		if err != nil {
			return err
		}
		affected = append(affected, cur...)
	}
	if len(c.add)+len(c.remove) > 0 && !c.resyncAll {
		if err := q.TouchSCIMGroup(ctx, g.ID); err != nil {
			return err
		}
	}
	if err := s.resync(ctx, q, o, affected); err != nil {
		return err
	}
	e := o.entry(action, "scim_group", g.ID.String())
	e.Before = before
	e.After = map[string]any{"displayName": g.DisplayName, "externalId": g.ExternalID}
	e.Metadata["membersAdded"], e.Metadata["membersRemoved"] = idList(c.add), idList(c.remove)
	return audit.Record(ctx, q, e)
}

// idList is at most 100 IDs for an audit entry, and the count.
func idList(ids []uuid.UUID) map[string]any {
	out := make([]string, 0, min(len(ids), 100))
	for _, id := range ids[:min(len(ids), 100)] {
		out = append(out, id.String())
	}
	return map[string]any{"count": len(ids), "ids": out}
}

// resync applies the SSO rules to each affected user once, in a fixed order.
func (s *Service) resync(ctx context.Context, q *dbgen.Queries, o Origin, users []uuid.UUID) error {
	slices.SortFunc(users, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	for _, id := range slices.Compact(users) {
		if err := ssogroups.SyncSCIM(ctx, q, id, ssogroups.Origin{RequestID: o.RequestID, ClientIP: o.ClientIP}); err != nil {
			return err
		}
	}
	return nil
}

// CreateGroup is POST /Groups.
func (s *Service) CreateGroup(ctx context.Context, o Origin, raw []byte) (dbgen.ScimGroup, error) {
	var b groupBody
	if perr := decodeStrict(raw, &b); perr != nil {
		return dbgen.ScimGroup{}, perr
	}
	if perr := checkGroupName(b.DisplayName); perr != nil {
		return dbgen.ScimGroup{}, perr
	}
	var g dbgen.ScimGroup
	err := s.groupTx(ctx, func(q *dbgen.Queries) error {
		values := make([]string, len(b.Members))
		for i, m := range b.Members {
			values[i] = m.Value
		}
		ids, err := resolveMembers(ctx, q, values)
		if err != nil {
			return err
		}
		if g, err = q.InsertSCIMGroup(ctx, dbgen.InsertSCIMGroupParams{DisplayName: strings.TrimSpace(b.DisplayName), ExternalID: optional(b.ExternalID)}); err != nil {
			return err
		}
		return s.applyMembers(ctx, q, o, g, membersChange{add: ids}, "scim.group_create", nil)
	})
	return g, err
}

func lockGroup(ctx context.Context, q *dbgen.Queries, id string) (dbgen.ScimGroup, error) {
	gid, ok := parseID(id)
	if !ok {
		return dbgen.ScimGroup{}, notFound("Group")
	}
	g, err := q.GetSCIMGroupForUpdate(ctx, gid)
	if errors.Is(err, pgx.ErrNoRows) {
		return g, notFound("Group")
	}
	return g, err
}

// change applies a name, external ID and members change to a locked group.
func (s *Service) change(ctx context.Context, q *dbgen.Queries, o Origin, g dbgen.ScimGroup, c groupChange) (dbgen.ScimGroup, error) {
	before := map[string]any{"displayName": g.DisplayName, "externalId": g.ExternalID}
	name, ext := g.DisplayName, g.ExternalID
	if c.DisplayName != nil {
		if perr := checkGroupName(*c.DisplayName); perr != nil {
			return g, perr
		}
		name = strings.TrimSpace(*c.DisplayName)
	}
	if c.ExternalID != nil {
		ext = optional(c.ExternalID)
	}
	var mc membersChange
	if name != g.DisplayName || !equalPtr(ext, g.ExternalID) {
		var err error
		if g, err = q.UpdateSCIMGroup(ctx, dbgen.UpdateSCIMGroupParams{ID: g.ID, DisplayName: name, ExternalID: ext}); err != nil {
			return g, err
		}
		mc.resyncAll = true
	}
	if err := s.memberDiff(ctx, q, g, c, &mc); err != nil {
		return g, err
	}
	if err := s.applyMembers(ctx, q, o, g, mc, "scim.group_update", before); err != nil {
		return g, err
	}
	return q.GetSCIMGroup(ctx, g.ID)
}

func (s *Service) memberDiff(ctx context.Context, q *dbgen.Queries, g dbgen.ScimGroup, c groupChange, mc *membersChange) error {
	add, err := resolveMembers(ctx, q, c.Add)
	if err != nil {
		return err
	}
	remove := make([]uuid.UUID, 0, len(c.Remove))
	for _, v := range c.Remove {
		if id, ok := parseID(v); ok {
			remove = append(remove, id)
		}
	}
	if c.Replace != nil {
		want, err := resolveMembers(ctx, q, *c.Replace)
		if err != nil {
			return err
		}
		cur, err := q.ListSCIMGroupMemberIDs(ctx, g.ID)
		if err != nil {
			return err
		}
		for _, id := range cur {
			if !slices.Contains(want, id) {
				remove = append(remove, id)
			}
		}
		for _, id := range want {
			if !slices.Contains(cur, id) {
				add = append(add, id)
			}
		}
	}
	mc.add, mc.remove = add, remove
	return nil
}

func equalPtr(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// ReplaceGroup is PUT /Groups/{id}: the name, external ID and members are replaced.
func (s *Service) ReplaceGroup(ctx context.Context, o Origin, id string, raw []byte) (dbgen.ScimGroup, error) {
	var b groupBody
	if perr := decodeStrict(raw, &b); perr != nil {
		return dbgen.ScimGroup{}, perr
	}
	members := make([]string, len(b.Members))
	for i, m := range b.Members {
		members[i] = m.Value
	}
	empty := ""
	if b.ExternalID == nil {
		b.ExternalID = &empty
	}
	var out dbgen.ScimGroup
	err := s.groupTx(ctx, func(q *dbgen.Queries) error {
		g, err := lockGroup(ctx, q, id)
		if err != nil {
			return err
		}
		out, err = s.change(ctx, q, o, g, groupChange{DisplayName: &b.DisplayName, ExternalID: b.ExternalID, Replace: &members})
		return err
	})
	return out, err
}

// PatchGroup is PATCH /Groups/{id}.
func (s *Service) PatchGroup(ctx context.Context, o Origin, id string, raw []byte) (dbgen.ScimGroup, error) {
	ops, perr := decodePatch(raw)
	if perr != nil {
		return dbgen.ScimGroup{}, perr
	}
	c, perr := patchGroup(ops)
	if perr != nil {
		return dbgen.ScimGroup{}, perr
	}
	var out dbgen.ScimGroup
	err := s.groupTx(ctx, func(q *dbgen.Queries) error {
		g, err := lockGroup(ctx, q, id)
		if err != nil {
			return err
		}
		out, err = s.change(ctx, q, o, g, c)
		return err
	})
	return out, err
}

// DeleteGroup is DELETE /Groups/{id}: its members lose the group, and the rules follow.
func (s *Service) DeleteGroup(ctx context.Context, o Origin, id string) error {
	return s.groupTx(ctx, func(q *dbgen.Queries) error {
		g, err := lockGroup(ctx, q, id)
		if err != nil {
			return err
		}
		members, err := q.ListSCIMGroupMemberIDs(ctx, g.ID)
		if err != nil {
			return err
		}
		if err := q.DeleteSCIMGroup(ctx, g.ID); err != nil {
			return err
		}
		if err := s.resync(ctx, q, o, members); err != nil {
			return err
		}
		e := o.entry("scim.group_delete", "scim_group", g.ID.String())
		e.Before = map[string]any{"displayName": g.DisplayName, "externalId": g.ExternalID}
		e.Metadata["membersRemoved"] = idList(members)
		return audit.Record(ctx, q, e)
	})
}

// GetGroup reads a group and, unless excluded, its members.
func (s *Service) GetGroup(ctx context.Context, id string, withMembers bool) (dbgen.ScimGroup, []dbgen.ListSCIMGroupMembersRow, error) {
	gid, ok := parseID(id)
	if !ok {
		return dbgen.ScimGroup{}, nil, notFound("Group")
	}
	q := dbgen.New(s.Pool)
	g, err := q.GetSCIMGroup(ctx, gid)
	if errors.Is(err, pgx.ErrNoRows) {
		return g, nil, notFound("Group")
	} else if err != nil || !withMembers {
		return g, nil, err
	}
	members, err := q.ListSCIMGroupMembers(ctx, g.ID)
	if members == nil {
		members = []dbgen.ListSCIMGroupMembersRow{}
	}
	return g, members, err
}

// ListGroups is a page of groups, filtered by displayName, externalId or id.
func (s *Service) ListGroups(ctx context.Context, f *Filter, p Page) ([]dbgen.ScimGroup, int64, error) {
	var params dbgen.CountSCIMGroupsParams
	if f != nil {
		v := f.Value
		switch f.Attr {
		case "displayname":
			params.DisplayName = &v
		case "externalid":
			params.ExternalID = &v
		case "id":
			id, ok := parseID(v)
			if !ok {
				return nil, 0, nil
			}
			params.ID = uuid.NullUUID{UUID: id, Valid: true}
		}
	}
	q := dbgen.New(s.Pool)
	total, err := q.CountSCIMGroups(ctx, params)
	if err != nil || p.Count == 0 {
		return nil, total, err
	}
	rows, err := q.ListSCIMGroups(ctx, dbgen.ListSCIMGroupsParams{DisplayName: params.DisplayName, ExternalID: params.ExternalID, ID: params.ID,
		Skip: int32(p.Start - 1), Take: int32(p.Count)})
	return rows, total, err
}
