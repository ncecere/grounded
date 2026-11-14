# Document permissions

A document can be restricted to some groups and people. Grounded then checks the reader's permissions wherever it
would show the document's text or use it in an answer. Everyone else gets answers without it. The design, with what
each part of Grounded does, is in [`specs/document-acls/DESIGN.md`](specs/document-acls/DESIGN.md).

## Turning it on (platform admins)

**Admin → Settings → Features → Document permissions** is off by default.

Turn it on **after every server runs this release**. A server of an earlier release doesn't know about restrictions
and would show restricted text. While the switch is off, nothing can be restricted.

It can't be turned off again while any document is restricted. Make every restricted source unrestricted first, so an
install never falls back to showing restricted text.

Turning it on or off is audited as `platform.document_permissions`.

## Restricting a source (team editors, admins and owners)

A source's **Access** tab has two choices:

- **Everyone who can use the knowledge:** the default, as before.
- **Only some groups and people:**
  - **Groups** are named as your identity provider names them: the groups sent at sign-in (the claim in
    `OIDC_GROUPS_CLAIM`) or provisioned by SCIM. The tab offers the groups it has seen.
  - **People** are email addresses. An address matches only when the identity provider has verified it
    (`email_verified`), or when the person is provisioned by SCIM.

Saving applies to every document of the source at once, and documents added later get the same restriction. The
change is audited as `source.access_update`, with the groups and people before and after.

## What a restriction does

People on the list see the source's documents as before: in search, answers, citations and the source viewer.

Everyone else gets the following:

| Where | What they get |
|---|---|
| Agent answers, in every channel | Answers without the restricted documents |
| Knowledge base search (REST, MCP, the knowledge base page) | No results from them |
| A citation in their own earlier conversation | "No longer available", once they're not on the list |
| The source's document list (editors and admins) | Each document's name and status, marked **Restricted** |
| A document's text and passages | Refused |
| Repeated-block samples | Hidden |

Some callers never read restricted documents:

- API keys, even a person's own;
- public pages and widgets;
- shared conversation links;
- evaluation runs.

Only a person signed in, or their own connected app on MCP, does.

Platform admins under **break-glass** read restricted documents; every read is audited, as before.

Two features change for restricted content:

- **The answer cache:** an agent whose knowledge includes a restricted document doesn't use it, because its answers
  depend on who asks.
- **Sharing:** a conversation that cites a restricted document can't be shared, and a link made before the
  restriction stops working.

## When changes take effect

Permissions are checked on every request, and nothing caches them.

- **Restricting a source or making it unrestricted** applies to the next question.
- **A person's groups from sign-in** change at their next sign-in.
- **SCIM group membership** changes at once.
- **A suspended person** has no access at all (SCIM suspension, or an admin).

## Limits

- At most 50 groups and people per source.
- Restrictions are set per source. Per-document permissions come from connectors (Microsoft 365 and Google Drive,
  planned for v0.12.0; the framework they use shipped in v0.11.0).
- Shared (platform) sources can't be restricted yet.
