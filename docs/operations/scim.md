# SCIM provisioning

Your identity provider can manage who has a Grounded account: it creates people before they first sign in, keeps their names
and email addresses current, and **suspends people who leave**. Its groups feed [SSO group mapping](sso-groups.md), so team
membership is still decided by your rules. The design and the reasons behind it are in
[specs/scim/DESIGN.md](../specs/scim/DESIGN.md).

SCIM needs a sign-in provider (`OIDC_ISSUER`): a person SCIM creates is linked to their account at their first sign-in.

## What it changes, and what it doesn't

| The identity provider can | It can't |
|---|---|
| Create a user, update their name, email and userName | Make anyone a platform admin or auditor, or change a team role |
| Suspend (`active: false`, or delete) and reactivate a user | Delete a person or their conversations (deleting suspends and unlinks; conversations follow retention) |
| Create groups and change their members, which the SSO rules turn into team memberships | Invite people, add them to teams directly, or read any content |

Suspending ends the person's sessions at once; their API keys, connected apps and MCP tokens stop working, as when a platform
admin suspends them in Admin → Users. **The last active platform admin is never suspended** by SCIM: the request fails and the
refusal is in the audit log.

Once a user is managed by SCIM, the identity provider decides whether they are active: Admin → Users shows **Managed by SCIM**,
and a person suspended there by hand may be reactivated by the next sync. Suspend them in the identity provider.

## 1. Create a token

**Admin → SCIM provisioning → Create token**, named after the identity provider. Copy the token at once: it is shown once. The
page also shows the **base URL** (`https://<your Grounded>/scim/v2`). A token reaches SCIM and nothing else; at most 10 are
active. To rotate one, create a new token, update the identity provider, then revoke the old one.

## 2. Choose the matching claim

A person SCIM creates is matched to their first sign-in by the identity provider's **object ID**, sent as SCIM `externalId`,
compared with the sign-in claim named by `SCIM_MATCH_CLAIM`. Email addresses are never used to match.

| Identity provider | `SCIM_MATCH_CLAIM` | externalId |
|---|---|---|
| Okta | `sub` (the default) | Okta's default: the Okta user ID, which is also the OIDC `sub` |
| Microsoft Entra ID | `oid` | Map **externalId** to **objectId** in the provisioning attribute mappings (Entra's default maps it to mailNickname). Entra's `sub` differs per application, so it can't be used. Add `oid` to the ID token if it isn't there (it is by default). |
| Others | The ID-token claim that holds the same value the provider sends as externalId | |

People who signed in before SCIM was set up are **linked, not duplicated**, when the provider first sends them: Grounded finds
the account whose identifier (the subject, or the matching claim from their latest sign-in) equals externalId. Someone who
hasn't signed in since `oid` was added to the token is linked at their next sign-in instead.

## 3. Configure the identity provider

### Microsoft Entra ID

1. Enterprise applications → your Grounded app → **Provisioning** → Automatic.
2. Tenant URL: the base URL. Secret token: the token. **Test Connection**.
3. Mappings → Users: map `externalId` to `objectId` and keep `userName`, `active`, `displayName`, `emails[type eq "work"].value`
   and `name.givenName`/`name.familyName`. Other attributes are accepted and ignored.
4. Mappings → Groups: keep `displayName`, `externalId` (objectId) and `members`.
5. Set `SCIM_MATCH_CLAIM=oid` in Grounded and restart it. Start provisioning.

### Okta

1. Applications → your Grounded app → General → enable **SCIM provisioning**.
2. Provisioning → Integration: SCIM connector base URL is the base URL; unique identifier field `userName`; supported actions:
   Push New Users, Push Profile Updates, Push Groups; authentication mode **HTTP Header** with the token.
3. Provisioning → To App: enable Create Users, Update User Attributes and Deactivate Users.
4. Keep `SCIM_MATCH_CLAIM=sub`.

### authentik

Tested end to end with authentik 2025.10 (creation, linking an existing user, a pending user's first sign-in, a group
driving a rule, and suspension).

1. **Sign-in:** an OAuth2/OpenID provider for Grounded with **Subject mode: Based on the User's hashed ID** (the default).
   Keep `SCIM_MATCH_CLAIM=sub`: authentik sends a user's `uid` (that hashed ID) as SCIM `externalId` whenever the user
   mapping doesn't set one, which its default mapping doesn't. With another subject mode, either set `externalId` in a
   custom user mapping to the same value as `sub`, or change the claim; never use the email.
2. **Provisioning:** a SCIM provider with the base URL and the token. Limit it with **User filtering → Group**, and to push
   only some groups, a group property mapping that raises `SkipObject` for the others.
3. **Assign the SCIM provider to the application** as a backchannel provider (Applications → your app → Backchannel
   providers) **before** it syncs: unassigned, authentik's sync finishes "successfully" without sending anything (its task
   log says "No provider found. Is it assigned to an application?"). After assigning it, save the provider again to sync.
4. authentik's default `email` scope reports `email_verified: false`. That doesn't affect SCIM or matching (which use the
   subject), only accepting team invites by email; set `OIDC_REQUIRE_VERIFIED_EMAIL=false` or add a mapping that reports
   verified addresses if you rely on invites.

## Groups and the rules

A SCIM group counts for the rules under its **name** and under its **externalId** (Entra puts the object ID in a `groups`
claim), both lower-cased, so a rule written for either matches. Changes apply at once: adding someone to a group adds them to
the rule's team; removing them removes memberships the rules made (never a membership someone added by hand).

Once the identity provider has pushed any group, a SCIM-managed person's groups come from SCIM only, not from their sign-in's
groups claim, so leaving a group takes effect immediately and isn't undone by an old claim. People SCIM doesn't manage keep
using the claim.

## Checking it

- Admin → SCIM provisioning: the tokens with when each was last used, and how many people and groups SCIM manages (and how many
  haven't signed in yet).
- Admin → Logs: every change, as the system, with the token's name (`SCIM created a user`, `SCIM suspended a user`, …), and the
  team membership changes that followed. A person's first sign-in after SCIM created them is `First sign-in linked to a SCIM
  account`.
- A request with no token, a wrong token, a revoked token, a session or an API key gets 401.

## Limits

Pages of at most 100 results; filters of the form `attribute eq "value"` on `userName`, `externalId`, `emails.value` and `id`
(users) or `displayName`, `externalId` and `id` (groups); groups of at most 10,000 members; request bodies of at most 1 MiB;
600 requests a minute per token. Bulk operations, sorting, ETags, passwords and `/Me` are not supported (the
ServiceProviderConfig says so).
