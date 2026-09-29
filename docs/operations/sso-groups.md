# SSO groups: mapping identity-provider groups to team roles

Platform admins can map a group from the identity provider (IdP) to a role in a team: *people in `registrar-staff` are editors of the Registrar team*. Grounded applies the rules each time someone signs in with OIDC, adding and removing members as their groups change. Members added by hand are never touched. The spec is [v0.2.0 §3.2 (E1)](../v0.2.0.md); the owner decision on hand-added members is §6, decision 2.

Group mapping is off until a rule exists. Without rules, sign-in only records each person's groups (for the dry run below).

## Configuration

| Setting | Default | Meaning |
|---|---|---|
| `OIDC_GROUPS_CLAIM` | `groups` | The ID-token claim that lists the person's groups. A list of strings; a single string counts as one group; other values are ignored. |
| `DEV_AUTH_GROUPS` | (empty) | Development only: fake groups for the dev personas, `persona=group,group;persona=group`, e.g. `alex=registrar-staff;blair=registrar-staff,library-staff`. |

The claim has to be in the **ID token**; Grounded doesn't call the userinfo endpoint.

- **Authentik:** the `profile` scope mapping sends `groups` (the group names). The default `OIDC_SCOPES=openid,profile,email` already asks for it.
- **Keycloak:** add a *Group Membership* mapper to the client (token claim name `groups`, *Add to ID token* on). Turn *Full group path* off unless your rules use paths like `/staff/registrar`.
- **Microsoft Entra ID:** set *groupMembershipClaims* in the app manifest. Entra sends group object IDs, not names, unless you configure *cloud-only group display names*; write the rules with whatever the token carries. Users in more than 200 groups get an overage marker instead of the list, which Grounded can't follow.
- **Other providers:** find the claim in a decoded ID token and set `OIDC_GROUPS_CLAIM` to its name.

Matching ignores upper and lower case, and surrounding spaces. Up to 1,000 groups of up to 256 characters are kept per sign-in.

## Rules

**Admin → Group mapping** lists every rule: the IdP group, the team, the role (owner, admin, editor or member) and how many memberships the rule grants now. A team's own rules are also on **Admin → Teams → the team → Group mapping**. Platform admins add, change and delete rules. Platform auditors see the rules (with a read-only notice) and can run the dry run through the API (`POST /v1/admin/group-mapping/preview`, below); the app shows the dry run only in the admins' rule form and delete confirmation.

- One rule per group and team. A rule's team can't change: map the group to another team with a new rule.
- Rules for an archived team are ignored, and no rule can be added to an archived team.
- Every rule change is audited: `platform.sso_rule_create`, `platform.sso_rule_update` and `platform.sso_rule_delete`, in the platform log and the team's log. The audit log's **SSO groups** area (API: `action=group_mapping.`) shows these and the memberships the rules added, changed or removed, whose actor reads "System (group mapping: *group* → *team*)". To see only those memberships, choose **System (group mapping)** under Person (API: `actorKind=group_mapping`), with the area **Team and members** or an action such as "Removed member" to see who a rule removed.

### The dry run

The rule form, and the delete confirmation, show what saving would do: who would be added, whose role would be raised or lowered, who would be removed, and who matches but is left alone (members added by hand, and a team's last owner). It uses the groups each person had **at their last sign-in**, so people who haven't signed in since the feature was installed, or whose groups changed since, aren't listed. They're matched at their next sign-in.

`POST /v1/admin/group-mapping/preview` returns the same list, for platform admins and auditors. It changes nothing.

### Saving applies at once

Saving or deleting a rule applies it immediately to everyone the dry run listed (people whose last-seen groups include the rule's group, and people the rule had already given a membership). After that the rules apply at every sign-in. Nobody is notified by the app; the changes show in the team's audit log.

## What happens at sign-in

After the invites for the person's email are accepted, Grounded reads the groups claim, saves it as the person's last-seen groups, and for each team:

1. **Add or raise.** For the rules the person matches, they get the rule's role: a new membership, or a higher role for a membership the mapping created. When several rules match one team, **the highest role wins** (the oldest rule among equals).
2. **Lower or remove.** A membership the mapping created is lowered to the role of the rules still matched, or removed when none matches. Removing a membership revokes the person's personal API keys for that team, as a hand removal does.
3. **Never touch hand-made memberships.** A membership added by hand (or by invite, or by a platform admin's *Assign owner*) is never changed by a rule, even when a rule would give a higher or a lower role. To let a rule manage such a member, remove them by hand; the rule adds them back at their next sign-in.

A sign-in without the claim counts as **no groups**: memberships the mapping created are removed. If your IdP stops sending the claim, the next sign-ins remove those members (and the sign-ins after the fix add them back). `grounded doctor`, the startup log and **Needs attention** on the admin Overview warn (`sso_groups_claim_missing`) when rules exist but no sign-in in the last 30 days carried the claim.

Every change is audited like a hand change (`team.member_add`, `team.member_role_change`, `team.member_remove`), with the system as the actor and `metadata.via = "sso_group_rule"`, the rule's ID and group, and the trigger (`sign_in` or `rule_change`). The logs show the actor as *System*, with *SSO group registrar-staff* under it.

### Where each membership comes from

Each membership records its source: `manual` (no marker) or `sso:<rule id>` (a row in `sso_memberships`). Team settings → Members shows **Managed by SSO group X** on members a rule manages. Owners and admins can't change their role or remove them by hand, and they can't leave the team themselves (`409 sso_managed`): the next sign-in would undo it. To take someone out, remove them from the group in the IdP, or ask a platform admin to change the rule. A platform admin's *Assign owner* on a managed member is the one exception: it makes the membership hand-made, owner, so the admin's recovery choice isn't undone at the next sign-in.

### The last owner

A rule never lowers or removes a team's **last owner**. If a person whose owner role came from a rule leaves the group while they are the only owner, the membership is kept, and each such sign-in records `team.sso_last_owner_kept`. Once the team has another owner (for example through *Assign owner*), the next sign-in removes or lowers them.

If the rule itself was deleted, such a kept membership has no rule. It no longer shows *Managed by SSO group*, and owners can change or remove it by hand; changing it makes it a hand-made membership.

## Limits

- Groups are read at sign-in only. Someone removed from a group in the IdP keeps the membership until they sign in again (sessions last `SESSION_TTL`, 12 hours by default); personal API keys keep working until then. Removing them by hand isn't possible while a rule manages them: delete or change the rule, or suspend the user, for an immediate stop. SCIM provisioning (E4) is planned for later.
- Adding someone because of a new rule uses their groups from their last sign-in, which may be out of date. Check the dry run's *Groups last seen* column.
- Rules don't send notifications.

## Trying it locally

With `DEV_AUTH=true`, set for example `DEV_AUTH_GROUPS=alex=registrar-staff` and restart. Add a rule for `registrar-staff` in Admin → Group mapping, then sign in as Alex Dev: Alex joins the team. Remove the persona from `DEV_AUTH_GROUPS`, restart and sign in again: Alex is removed. The integration tests (`internal/httpapi/groupmapping_integration_test.go`) use the test OIDC provider in `internal/testutil/oidcprovider.go`.
