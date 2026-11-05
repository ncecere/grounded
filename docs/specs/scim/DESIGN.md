# SCIM provisioning (E4, #35)

Status: accepted for v0.9.0 (the owner's decision in [v0.9.0.md](../../v0.9.0.md#scim-provisioning), option A; the matching rule
recommended on 2026-11-05 and accepted with "follow your recommendations").

## What it does

The identity provider (Entra ID, Okta, or any SCIM 2.0 client) manages **people and whether they are active**:

- it creates users before their first sign-in, and updates their names and email addresses;
- it **suspends** people who leave (`active: false`, or DELETE): their sessions end at once, and their API keys, connected apps
  and MCP tokens stop working, as with a suspension by a platform admin; their conversations follow retention;
- it reactivates them (`active: true`);
- **SCIM Groups** feed the existing **SSO group → team rules** ([operations/sso-groups.md](../../operations/sso-groups.md)), so
  team membership is still decided in one place: the rules.

It does not manage teams, roles, platform roles, invites or content. SCIM never deletes a user: DELETE suspends and unlinks.

## Protocol

RFC 7643/7644, at **`/scim/v2`** (outside the `/v1` API, like `/oauth`):

| Endpoint | Supported |
|---|---|
| `GET /ServiceProviderConfig`, `/ResourceTypes`, `/Schemas` | Static documents: PATCH yes, bulk no, filter yes (max 100 results), change password no, sort no, ETag no (resources carry `meta.version`; If-Match is not enforced) |
| `GET /Users` | `filter` with `eq` on `userName`, `externalId`, `id`, `emails.value` (also written `emails[type eq "work"].value`); `startIndex`, `count` (≤ 100) |
| `GET /Users/{id}`, `POST /Users`, `PUT /Users/{id}`, `PATCH /Users/{id}`, `DELETE /Users/{id}` | Core user schema: `userName`, `externalId`, `name`, `displayName`, `emails`, `active` |
| `GET /Groups`, `GET /Groups/{id}`, `POST`, `PUT`, `PATCH`, `DELETE` | `displayName`, `externalId`, `members` (users by `id`); `excludedAttributes=members`; `filter` with `eq` on `displayName`, `externalId`, `id` |

PATCH accepts what Entra and Okta send: `op` in any case (`Replace`), booleans as strings (`"False"`), operations with a path
(`active`, `userName`, `displayName`, `name.givenName`, `name.familyName`, `name.formatted`, `emails`,
`emails[type eq "work"].value`, `members`, `members[value eq "…"]`) or without one (an object of attributes). Errors use the
SCIM error schema with `scimType` (`invalidFilter`, `invalidValue`, `uniqueness`, `mutability`, `noTarget`, `invalidSyntax`).
Both `application/scim+json` and `application/json` are accepted; responses are `application/scim+json`.

## Tokens

A **SCIM token** is a bearer secret (`scim_…`, 32 random bytes), shown once, stored as its SHA-256 digest, named (e.g.
"Entra ID"), at most 10 active. Platform admins create and revoke them in **Admin → SCIM provisioning** (signed in, never
through an API key or OAuth: `POST`/`DELETE /v1/admin/scim/tokens`), auditors see the list (never the secret). A token reaches
`/scim/v2` and nothing else, and nothing else reaches `/scim/v2`: an API key, a session or an OAuth token is refused there.
Requests are rate-limited per token (600 a minute) and failed authentications per client address. `lastUsedAt` is updated at
most once a minute.

## Matching a SCIM user to a sign-in (the decision)

Grounded identifies a person by the identity provider's issuer and **subject** (`sub`). A user SCIM creates has not signed in,
so it has no subject yet. It is matched by the identity provider's **object ID**, which SCIM sends as `externalId`:

- `externalId` is **required** on POST and never changes afterwards (`mutability` error).
- At sign-in, the claim named by **`SCIM_MATCH_CLAIM`** (default `sub`) is compared with `externalId`. Okta's SCIM
  `externalId` is the Okta user ID, which is also the OIDC `sub`: the default works. Entra ID's `sub` differs per application,
  so with Entra set `SCIM_MATCH_CLAIM=oid` and map `externalId` to `objectId` in the provisioning attribute mappings.
- Email addresses are **never** used to match: an address can be changed or reused, and matching on it could hand one person's
  account to another.

A SCIM-created user is stored with the configured issuer and a placeholder subject (`scim-pending:<user id>`), which no
sign-in can produce. At the first sign-in whose claim equals `externalId`, the placeholder is replaced by the real subject in
the sign-in transaction; from then on sign-in finds the user as before.

**People who signed in before SCIM** are linked, not duplicated: a POST whose `externalId` equals an existing, unlinked
user's identifier (their subject when `SCIM_MATCH_CLAIM=sub`, otherwise the claim kept from their last sign-in) links that
user and returns it with 201. A second POST for an already linked `externalId` is a `uniqueness` error (409).

SCIM sees only the users it created or linked (`users.scim_external_id` is set). It needs OIDC: without `OIDC_ISSUER`
`/scim/v2` answers 404 (development login keeps working without it; tests use the development issuer).

## Groups and the SSO rules

SCIM groups are stored (`scim_groups`, `scim_group_members`). A SCIM-linked user's **groups for the SSO rules** are the
normalised `displayName` **and** `externalId` of each SCIM group they are in, so a rule written for a group's name or for
its object ID (what Entra puts in a `groups` claim) both work. When a membership or a group's name changes, each affected
user's groups are re-synced through `ssogroups.Sync` with the trigger `scim`, in the same transaction, so team memberships
follow at once and are audited as rule changes are.

Once the identity provider has pushed at least one group, SCIM is the **only** source of groups for SCIM-linked users: their
sign-in uses their SCIM groups, not the groups claim, so a person removed from a group in the identity provider loses it at
once rather than at their next sign-in. Users who are not SCIM-linked keep using the claim. Before any group is pushed,
sign-in uses the claim for everyone, as today.

## Suspension and the last admin

`active: false` and DELETE suspend through the same rule as Admin → Users: sessions are deleted in the transaction. The last
active platform admin is never suspended by SCIM: the request fails with 409 and the refusal is audited, so a mis-scoped
provisioning job can't lock everyone out. Reactivation (`active: true`) is allowed only for users SCIM manages; a user a
platform admin suspended by hand is reactivated by SCIM too (the identity provider is the source of truth for active
status once a user is linked), which the Users page says next to the SCIM badge.

## Audit

Every change is audited with `actor_kind = system` and metadata `{"via": "scim", "scimTokenId", "scimTokenName"}`:
`scim.user_create`, `scim.user_link`, `scim.user_update` (before and after: name, email, userName; never other attributes),
`scim.user_suspend`, `scim.user_reactivate`, `scim.user_unlink`, `scim.group_create`, `scim.group_update` (members added and
removed, as user IDs), `scim.group_delete`, `scim.suspend_denied`; `platform.scim_token_create`, `platform.scim_token_revoke`;
`auth.scim_link` at the sign-in that replaces the placeholder. Team membership changes that follow are audited by
`ssogroups` (`team.member_*` with trigger `scim`). Reads are not audited.

## Bounds

Pages of at most 100; a group of at most 10,000 members (a PATCH adding more is `invalidValue`); request bodies of at most
1 MiB; display names and userNames of at most 256 characters; emails of at most 320. Filters are parsed by a small parser
that accepts only `attr eq "value"` (optionally joined with nothing else): anything else is `invalidFilter`, never a query.

## Storage and compatibility

Migration 00064 (expand only): `users.scim_external_id` (unique where set), `users.scim_user_name`; tables `scim_tokens`,
`scim_groups`, `scim_group_members`. The previous release ignores them; a rollback keeps working (a SCIM-created user who
never signed in stays pending until the next upgrade). Nothing is dropped.

## Not in this change

Bulk operations, sorting, password and enterprise-extension attributes (except none: department, manager are ignored), and
`/Me`. Per-team SCIM or several identity providers (Grounded has one OIDC issuer).

## Tests

Protocol: create, link, filter, get, list, replace, patch (Entra and Okta shapes), delete; groups with members and the SSO
rules applied; the matching claim at sign-in (default and `oid`), never by email; tokens (scope, revoked, wrong token, a
session or API key refused); last-admin refusal; audit entries; bounds and malformed input. Authorization matrix for the admin
endpoints. Web: the admin page with axe.
