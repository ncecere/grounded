# Source types and connectors

A data source has a **type**. Two types are built in: **upload** (files people add) and **web** (pages the crawler
fetches). Every other type is a **connector**: it fetches documents from another system, on a schedule, with that
system's permissions where it reports them.

The design is in [ADR-0035](adr/0035-source-type-registry-and-connectors.md). This release has the framework and no
connector yet; the first ones (SharePoint, OneDrive, Google Drive) follow.

## For platform admins

### Turning a type on

`GET /v1/source-types` lists the types this server has and what each can do. Upload and web are on. **A connector type
is off until you turn it on**, and two things must be true before a team can use it:

1. The type is on: `PUT /v1/admin/source-types/{key}` with `{"enabled": true}` (audited as `platform.source_type`).
2. A classification level allows it: add the type to the level's allowed source types. A new type is in none of them,
   so you choose which classifications of data may come from it.

Turn a type on **after every server runs the release that has it**. A server of an earlier release doesn't know the
type and would not sync it.

A connector that reports document permissions also needs **Document permissions** on
([guide](document-permissions.md)): without it, a source of that type can't be made.

### Turning a type off

Off means:

- no new source of the type can be made (`409 source_type_off`);
- its sources start no sync, by hand or on schedule.

Its sources and their documents stay, and stay searchable. Turn the type on again and they sync as before.

### Settings

| Setting | Default | What it does |
|---|---|---|
| `CONNECTOR_CONCURRENCY` | 2 | Sources syncing at once in each worker process |
| `CONNECTOR_REMOVAL_HOLD_PERCENT` | 30 | A sync that would remove more than this share of a source waits for an editor (see below) |

Connectors reach **public addresses only**, as the crawler does. No setting lifts that.

A team's limits on documents and storage apply to connector sources as to any other.

### Credentials

A connector source's credentials (a token, a client secret, a key file) are stored encrypted with `ENCRYPTION_KEY`,
bound to their source. They are write-only: no API response, audit entry or log shows them. `grounded rotate-keys`
re-encrypts them with the other stored secrets ([rotating keys](operations/rotate-keys.md)).

### Monitoring

| Metric | Meaning |
|---|---|
| `grounded_connector_syncs_total{type,result}` | Syncs that ended: `completed`, `held`, `stopped`, `failed`, `cancelled` |
| `grounded_connector_items_total{type,result}` | Items handled: `added`, `changed`, `unchanged`, `skipped`, `removed` |

A rising `failed` count for one type usually means its provider is refusing credentials or is down. `held` means a
sync found far fewer documents than before and removed nothing; an editor has to look.

### A source of a type this server doesn't have

If a server is replaced by a build without one of its connectors, the sources of that type stay with their documents,
and stay searchable. They can't sync or take uploads, and they are never deleted for it. They work again when the
connector returns.

## For team editors

### Adding a connector source

Choose the type, give its settings and credentials, and pick a schedule: only on request (the default), hourly, daily
or weekly. **Test connection** says who the credentials are and what they can read, before anything is saved. The first
sync starts when the source is created.

### What a sync does

A sync asks the provider what changed since the last one:

- a new item becomes a document;
- a changed item becomes a new version of its document. An item whose content didn't change is not downloaded again;
- a renamed or moved item keeps its document;
- an item the provider no longer has is removed.

A **full** sync lists everything again. It also finds documents the provider no longer has, when the provider didn't
say so. The first sync, and the first after you change the settings or credentials, is always full.

Each sync shows what it added, changed, left alone, skipped and removed. Skipped items are listed with the reason: a
kind of file that isn't indexed, a file over the size limit, an empty file. Images are not indexed by connectors.

### When a sync would remove a lot

A sync that would remove **every document** of a source, or **more than 30% of them** (and at least 10), removes
nothing. It holds its removals and the source says so. This is deliberate: a revoked permission, a wrong folder or an
outage can look exactly like "everything was deleted".

Look at the list of what would be removed, then:

- **Confirm**: the documents are removed.
- **Dismiss**: they stay. The next full sync decides again.

Starting another sync replaces an undecided hold with whatever the new sync finds.

### When a sync fails

- **The provider refused the credentials:** the sync fails at once. Enter new credentials in the source's settings.
- **The provider was unavailable, or anything else:** the sync is tried again three times, after one, five and
  twenty-five minutes, then fails. A failed sync removes nothing, and the next one starts where it would have.
- **The team reached its documents or storage limit:** the sync stops, keeps what it added and removes nothing.

You can cancel a running sync. What it already added stays.

### Permissions

Some connectors report who may read each document. For those sources:

- each document is readable by the people and groups the provider names, and by nobody else, whatever their role in
  the team. Editors still see every document's name and status;
- a permission the connector can't express gives **nobody** access, never more people. A link "for anyone" is the
  usual case. The document says why;
- a change of sharing, or of who is in a group, applies at the next sync;
- the source's **Access** tab can't restrict it by hand: the provider decides.

A connector that reports no permissions works like an upload source: restrict the whole source by hand in its Access
tab if it needs it.

Everything in the [document permissions guide](document-permissions.md) applies: API keys, public pages and shared
links never read restricted documents.

## API

| Operation | Who |
|---|---|
| `GET /v1/source-types` | Anyone signed in |
| `PUT /v1/admin/source-types/{key}` | Platform admins |
| `POST /v1/teams/{team}/source-types/{key}/check` | Team editors and above: test settings before a source exists |
| `POST /v1/teams/{team}/sources` with `connector` | Team editors and above |
| `PUT /v1/teams/{team}/sources/{id}/connector` | Team editors and above (`If-Match`): settings, credentials, schedule |
| `POST /v1/teams/{team}/sources/{id}/connector/check` | Team editors and above |
| `GET /v1/teams/{team}/sources/{id}/syncs` | Team members, or an API key that can read |
| `POST /v1/teams/{team}/sources/{id}/syncs` | Team editors and above, or an API key with the ingest scope |
| `POST /v1/teams/{team}/sources/{id}/syncs/{syncId}/cancel` | Team editors and above |
| `GET`, `POST /v1/teams/{team}/sources/{id}/syncs/{syncId}/removals` | Team editors and above |

Connector sources are team sources. A shared (platform) source is an upload or a web source.

Audit actions: `platform.source_type`, `source.create`, `source.connector_update` (which parts changed, never a
credential), `source.sync`, `source.sync_cancel`, `source.removals_confirm`, `source.removals_dismiss`.

Webhooks: `source.synced` and `source.sync_failed` also fire for connector sources, with `sourceType` and `syncId`.

## Writing a connector

A connector is one Go package. It registers a type and implements three methods
([`internal/connector`](../internal/connector/connector.go)):

- `Config` validates the source's settings and returns them as stored. It makes no request.
- `Check` uses the credentials and says what they reach.
- `Sync` lists what changed and hands each item to the sink.

The runtime does the rest: stored credentials, scheduling, limits, throttling (it waits on `429` and on `503` with
`Retry-After`), safe removal, permissions and ingestion. A connector never touches the database.

The rules that keep a connector correct:

1. **An item's ID is stable.** A rename or a move keeps it.
2. **Version changes when the content does.** The sink only asks for content when the version differs.
3. **Report a listing complete only when it covered everything the settings select.** What a complete listing doesn't
   mention is removed.
4. **A connector that reports permissions sets them on every item.** What it can't express maps to the nearest
   narrower principal or to nobody, with a note.
5. **Return the sink's errors unchanged.** They stop the sync.
6. **Never put a credential in an error or a log line.**

The reference is the in-memory provider in
[`internal/connector/connectortest`](../internal/connector/connectortest/provider.go), and the conformance tests
`TestConnector*` in `internal/httpapi`: a new connector's tests repeat them against recorded answers of its provider.
