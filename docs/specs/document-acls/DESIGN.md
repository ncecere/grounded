# Document permissions (B6, #41)

Status: **design, 2026-11-05; being built.** The decisions are recommendations the owner let stand ("keep going",
2026-11-05; [`../../v0.10.0.md`](../../v0.10.0.md)); any of them can still change before v0.10.0 is released.

## Goal

A document can be restricted to people and groups. Wherever Grounded would show its text, or use its text in an
answer, the asker's permissions are checked first, and the check fails closed. This must exist before any connector
reads private content (Microsoft 365, Google Drive). Until then, editors can restrict a source by hand, which is
useful on its own.

What changes for an install that restricts nothing: nothing. Unrestricted documents behave exactly as today. That
includes the answer cache, which keeps working for agents whose knowledge has no restricted document.

## Model

### A document's permissions

`documents.acl_principals text[]`:

- **NULL:** unrestricted (every document today).
- **A list:** restricted to those principals. An empty list means nobody.

The column `documents.acl jsonb`, reserved since 00004, keeps what the source reported (a connector's raw permissions,
or the hand-set restriction), for display and audit. Enforcement only ever reads `acl_principals`.

A source restricted by hand (decision 6) stores its list on `data_sources.acl_principals`. Ingest copies that list to
each of the source's documents, and a change to it rewrites them in one statement. A connector writes each document's
own list.

### Principals

A principal is a namespaced string, normalised (lower case, trimmed):

| Principal | Matches |
|---|---|
| `user:<uuid>` | That Grounded person |
| `subject:<value>` | The person's identity-provider subject (`sub`), and their SCIM `externalId` (the `SCIM_MATCH_CLAIM` value, for example Entra's `oid`) |
| `email:<address>` | The person's email, **only when verified** (OIDC `email_verified` true, or provisioned by SCIM) |
| `group:<value>` | A group in the person's last sign-in groups claim (`sso_user_groups`), or a SCIM group they are in (its display name and its `externalId`) |
| `source:<source id>:<group id>` | A connector's own group, which the connector expands to its members' principals (`source_group_members`, written at sync) |

A connector maps the provider's permissions onto these. For example, a SharePoint file shared with an Entra group
becomes `group:<group object id>`, and a Drive file shared with a person becomes `email:<address>`.

A principal Grounded can't resolve is kept, and simply never matches. It is never dropped and never widened. A
connector whose permission it can't express ("anyone in the organisation with the link", a domain) maps it to the
nearest narrower principal it can resolve. If there is none, the document gets an empty list (nobody) and the
connector records why on the document.

### The asker's principals

These are computed **per request** from the database and never cached across requests (decision 7):

- `user:<id>`;
- `subject:` for each linked identity;
- `email:` if verified;
- `group:` for the groups in `sso_user_groups`, plus SCIM groups;
- `source:` groups from `source_group_members` that list any of the above.

The asker is a person only on a signed-in session in the app, or on that person's own OAuth grant on MCP. Every other
caller has **no principals**. That covers API keys, even personal ones, publishable keys, the public page, the
widget, webhooks, evaluation runs and background jobs. Such a caller sees restricted documents nowhere (decision 3).

## Enforcement

**One rule:** text from a restricted document reaches a reader only through a query that has the reader's principal
set in its `WHERE`. A restricted document's text is never loaded first and filtered in Go.

Two places apply this rule through a gate rather than in every query:

- **The viewers.** `GetViewerDocument` takes the reader's principals and returns no row for a document they may not
  read. Its passages (`ListViewerChunks`) are only listed for a document it returned.
- **Ingest.** It reads chunks to rechunk and re-embed. That isn't a read by a person, so it doesn't apply permissions.

`TestEveryPassageTextQueryChecksPermissions` reads every query in `internal/store/queries`. Any query that selects chunk
content must check `acl_principals` or be listed with its reason, so a new query fails the test until its author
decides.

### Retrieval

`vectorstore.DocFilter` gains `Principals []string` and `Restricted bool`. These come from the asker, never from a
request field. Its SQL adds:

```sql
AND (d.acl_principals IS NULL OR d.acl_principals && $principals)
```

Where the condition goes:

- **Vector and keyword candidate queries:** only when a searched source has restricted documents. This keeps the
  query plans of an install that restricts nothing. `data_sources.restricted_documents` is set by a trigger the moment
  any of the source's documents is restricted, and nothing ever clears it.
- **`LoadChunks` and `LoadParentPassages`, which read the text:** always, whatever the candidate stage did. If a
  document is restricted during a search, it can only drop out of the results; its text never leaks.

A GIN index on `acl_principals` covers the overlap. `kbs.Search` and `ExpandParents` refuse to run without a decision
about the caller (`access.ErrNoCaller`): a `Caller` must be set explicitly, either `Anyone` (no principals) or a
person's set. A new call site that forgets to set it fails a test instead of leaking.

Parent expansion reads the parent of a matched passage. The parent comes from the same document, so it carries the
same permissions, and its query re-applies the filter anyway.

### Every other place that shows document text

Each of these gets an integration test where a restricted document is invisible to a person outside its list and
visible to one on it:

| Surface | Check |
|---|---|
| Agent answers, all channels (app, public, widget, OpenAI API, MCP) | Retrieval as above. The router passes the same caller to its sub-agent |
| Citations and the source viewer (`CitedPassage`, `PublicCitedPassage`, `SharedCitedPassage`, `DocumentText`) | Re-checked on every open; refused as not found, so a restricted document's existence isn't revealed |
| Knowledge base search (`POST .../retrieve`, Try it, the knowledge base page) | Retrieval as above; API keys get unrestricted documents only |
| Source document list and document page | Name, status and permissions are shown to editors and admins; text, passages and the viewer only to principals (decision 4) |
| Index preview, boilerplate samples, contextual-chunk preview, PII review, content health samples | Text only for principals; otherwise "restricted" with counts |
| Evaluation runs | No principals: restricted documents never count. The run records how many were skipped |
| Answer cache | A restricted passage keeps an answer out of the cache. An agent whose knowledge has any restricted document doesn't look up the cache (decision 5) |
| Conversation export | Export holds the person's own conversation as stored; citations to documents they can no longer read have no text |
| Conversation sharing | Refused when an answer cited a restricted passage (decision 5) |
| Configuration export | Never carries documents. A source's hand-set permissions export as principals |
| Break-glass | A document read under break-glass ignores permissions and is audited, as today |
| Gap report, analytics | Show questions and counts, never document text; unchanged |

### Revocation

Permissions are evaluated at query time, so a change takes effect on the next request once it is stored (decision 7).
Removing a person ends their sessions (existing behaviour). Suspension through SCIM ends sessions and stops their
grants. Nothing holds a decision: there is no principal cache, and the answer cache never holds restricted answers.

## API and UI

- `Document.access`: `unrestricted`, or `{restricted: true, principals: [...], origin: "source" | "connector"}`.
  Editors and admins can read it; it shows on the document page with a lock.
- `PUT /v1/teams/{team}/sources/{id}/access`: a hand-set restriction (If-Match; audited as `source.access_update`;
  team editors and up).
  - The body lists groups (as the identity provider names them) and people.
  - Clearing it makes the source unrestricted.
  - A connector's source refuses a hand-set restriction, because its permissions come from the provider.
- The source page gets an **Access** section: "Everyone who can use this knowledge" or "Only these people and
  groups", with a group picker that offers the groups already seen at sign-in and from SCIM.
- An agent whose knowledge has restricted documents shows a notice in the editor. Public, widget and API callers will
  never see those documents, and the answer cache is off for it.

## Migration

One expand-only migration:

- `documents.acl_principals text[]` and `data_sources.acl_principals text[]`, both NULL;
- a GIN index on `documents (acl_principals) WHERE acl_principals IS NOT NULL`, built concurrently in a
  no-transaction migration with the same invalid-index guard as 00066;
- `source_group_members (source_id, group_id, principal)`.

Old code ignores the new columns, so a pod of the previous release would ignore a restriction. Restrictions are
therefore behind a platform feature switch, **Document permissions** (Admin → Settings → Features), which is off by
default, the same pattern as audit streaming. The upgrade notes say to turn it on only after the rollout. While it's
off, no restriction can be set and connectors with permissions can't be added. Turning it off again is refused while
any document is restricted, so an install can't silently fall back to showing restricted text.

## Tests

- **A leak test:** a principal, a non-principal person (an editor, and the team's owner), an API key and an anonymous
  public visitor each ask for a restricted document through:
  - knowledge base search;
  - an agent's answer;
  - the viewer;
  - whole-document text;
  - document passages;
  - sharing.

  Only the principal gets it. The check is for the document's text itself, so a leak through any field fails. The
  test fails when the permission check is taken out of search.
- **The query guard** above, for every query that reads chunk content.
- **Search:** hybrid search returns a restricted passage only to a principal, including when it would rank first;
  parent collapse doesn't pull a restricted parent into an unrestricted hit.
- **Revocation:** remove a group from `sso_user_groups` and from SCIM, and the next request no longer sees the
  document.
- **Cache:** a principal's restricted answer is not stored, and a non-principal asking the same question gets
  neither the answer nor a cache hit.
- **Performance:** a knowledge base where 90% of documents are restricted from the asker still returns the top k
  (iterative scan), measured with the retrieval benchmark.

## Built so far

- **Part 1:** migration 00068, `internal/access`, and enforcement on every surface in the table. Nothing can set a
  restriction yet, so nothing changes for an install.
  - **Evaluation runs** are marked explicitly (`run.evaluation`) and read as Anyone.
  - **Repeated-block samples** are hidden when their canonical document is restricted from the reader. If that
  document is gone, they're hidden whenever the source ever had a restricted document.
- **Part 2:** the Document permissions switch, the source **Access** tab and `PUT …/sources/{id}/access`, and the list
  of groups seen at sign-in and through SCIM (`GET …/access/groups`). Documents show a **Restricted** badge.
  - A new document of a restricted source gets the restriction through an insert trigger. The trigger reads the
    source `FOR SHARE`, so an insert made while the restriction changes waits for the change and gets the new list.
  - Restricting is refused while the switch is off. Turning the switch off is refused while any document is
    restricted.
  - Shared (platform) sources can't be restricted yet.
  - Guide: [`../../document-permissions.md`](../../document-permissions.md).

## Open questions for the connectors (B1, B2)

- Microsoft 365: Graph returns permissions per item. Inherited permissions and sharing links need care: an "anyone"
  link maps to nobody, and an "organisation" link maps to a tenant group principal that every signed-in person from
  that tenant has.
- Google Drive: groups are email addresses, and Google doesn't send groups at sign-in. Expanding a group needs the
  Admin SDK Directory API and an admin-consented service account.
