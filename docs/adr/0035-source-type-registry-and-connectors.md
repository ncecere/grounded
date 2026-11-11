# ADR-0035: A source type registry, and connectors built on it

- Status: Accepted (2026-11-11; built in #258: the registry, then the connector runtime)
- Date: 2026-11-11
- Changes: [ADR-0008](0008-data-source-plugins-and-native-web-crawler.md)

## Context

ADR-0008 decided that each source type would be a Go plugin implementing `SourceType` and writing to a `DocumentSink`.
That interface was never built. The two types, `upload` and `web`, were written directly:

- `data_sources.type` was `CHECK (type IN ('upload', 'web'))`, and each classification level's allowed types were checked
  against the same list;
- about twenty backend files and ten pages of the web app compared a source's type with a name (boilerplate detection,
  content health, re-embedding, uploads, the API's enum).

The connectors planned for v0.11.0 (SharePoint, OneDrive, Google Drive) and after would each have added a migration and
another branch in each of those places.

## Decision

### A registry of types, asked about capabilities

`internal/sourcetypes` holds the registered types: a key, a name, a description, **capabilities**, and for connectors a
JSON Schema of the settings and the list of credentials. The rest of the code asks about a capability and never
compares a type with a name:

| Capability | Means | Upload | Web |
|---|---|---|---|
| `uploads` | People add files by uploading them | yes | no |
| `sync` | The source fetches its own content | no | yes |
| `webPages` | Documents are web pages: identified by address, main content only, repeated blocks left out by default, links checked | no | yes |
| `permissions` | `none`: an editor may restrict the source by hand. `provider`: the type reports each document's permissions, and the source refuses a hand-set restriction | none | none |
| `shared` | A platform admin can make a shared source of the type | yes | yes |

A type this build does not know (a source made by a build that had another connector) has no capabilities. Its source
and documents stay, and stay searchable; nothing uploads to it or syncs it. It is never deleted for being unknown.

### Upload and web are the first two types, unchanged

They are registered as they are. **The crawler keeps its own crawl state, frontier, robots rules and pacing; upload
keeps having no sync; both keep their hand-built pages.** They are not rebuilt on the connector runtime below: the
crawler is the most used and most tested part of ingestion, and a generic sync would give it nothing.

### The database stops listing types

Migration 00070 replaces the two lists with a format check on the key. The application validates a type against the
registry. Adding a connector needs no migration.

### A platform admin turns each type on or off

`source_type_settings` holds the switch. With no row, upload and web are on, and every other type is **off**. Off means
no new source of the type and, for a connector, no new sync; existing sources and their documents stay. A type must
also be in a classification level's allowed types to hold data at that level, and a new type is in none of them, so
turning a type on and choosing where it may be used are two deliberate steps.

A new type is turned on after the upgrade's rollout: a server of the previous release does not know it.

### Connectors

A connector is a package that registers a type and implements three things (`internal/connector`): validate its
settings, check a credential, and sync. A sync lists what changed since a saved cursor and hands each item to a
**sink**, which is the one way into the existing parse, chunk, embed and commit steps. The runtime
(`internal/sourcesync`), not the connector, owns:

- **Credentials.** Stored encrypted per source (`source_connectors`, bound to the source by its associated data),
  write-only in the API, redacted from errors, and rotated with the other secrets.
- **Syncs.** River jobs, one per source at a time, on demand or on a schedule (hourly, daily, weekly). A failed sync is
  tried again after one, five and twenty-five minutes. A long sync checkpoints, and a restart of the same sync
  continues from the checkpoint. The source's cursor is saved only when a sync ends, so a failed sync never leaves the
  next one starting in the middle of a listing.
- **Unchanged content is not read again.** An item carries a version; the sink asks for content only when it differs,
  and then compares the hash.
- **Deletion safety.** A sync collects what it would remove: what the provider said was deleted and, after a complete
  listing, what the listing did not mention. That is removed when the sync ends, unless it would empty the source or
  remove more than 30% of it (and at least 10 documents). Then nothing is removed and the removals wait for an editor
  to confirm or dismiss. A failed, cancelled or limit-stopped sync removes nothing.
- **Permissions.** The connector reports principals and its own groups; the runtime writes `documents.acl_principals`
  and `source_group_members` (the document-permissions design). It fails closed: a missing report, an entry that isn't
  a principal and a list too long to keep all end as fewer readers, never more. Permissions that change without the
  content changing are applied without reading the content. Such a source needs the Document permissions switch on and
  refuses a hand-set restriction.
- **Limits.** A team's documents and storage limits apply; reaching one stops the sync and removes nothing.
- **Outbound requests.** One client for every connector: it refuses private addresses, checked when connecting, so a
  redirect or a name that changes its answer is caught, and it waits when the provider throttles.

Polling with cursors first; provider webhooks are each connector's later decision.

### Not decided here

- **Hosts on private addresses.** A self-hosted Confluence or an S3-compatible server sits on a private address. The
  project allows no configuration setting that lifts the address check (a test refuses one), so there is none. How a
  platform admin allows one host is decided with the first connector that needs it; the client already takes a list.
- **Shared (platform) sources of a connector type.** Not offered: shared sources can't be restricted yet.
- **Configuration as code** carries upload and web sources only. A connector source is refused on export with the
  reason, as before; carrying its settings (never its credentials) is a follow-up.
- **Per-type limits** beyond the team's documents and storage limits.

## Consequences

- A connector is its own package, its registration and its documentation. No migration, no enum, no new branch.
- The API's source `type` is an open string, and `GET /v1/source-types` describes each type. A client that listed the
  two types must read the list instead. Existing clients that only send `upload` or `web` are unaffected.
- A type's behaviour now hangs on its declared capabilities. A wrong declaration is a bug that the type system doesn't
  catch, so each connector runs a shared conformance test.
- An install can hold sources of a type its build no longer has. They are inert until the type returns.
- The web crawler and the connector runtime are two ways to sync. That duplication is accepted for the reason above.

## Alternatives considered

- **Keep branching on type names.** Rejected: every connector would touch the same twenty files and add a migration.
- **Rebuild web and upload on the connector runtime.** Rejected: high risk to the two types every install uses, for no
  gain; the crawler's frontier and pacing don't fit a cursor.
- **Go plugins loaded at run time, or connectors as separate services.** Rejected for now: the product is one binary
  (ADR-0001), and an out-of-process protocol is a larger surface to secure. The registry leaves room for it.
- **An instance registry passed to every caller** instead of a package-level one. Rejected: about a dozen packages ask
  about capabilities, and types are fixed at start-up, like database drivers.
