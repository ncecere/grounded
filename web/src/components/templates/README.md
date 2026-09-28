# Page templates

Grounded's page shapes from the UI plan (`docs/ui-review/README.md`, D3–D5, Q13). They're composed from bitop-ui items. Build pages on them rather than laying out headers, tabs, save bars and tables by hand, so every page has the same structure. Tests: `src/test/templates.test.tsx`.

| Template | File | Use for |
|---|---|---|
| `DetailPage` | `detail-page.tsx` | A container's page: source, KB, agent, team, user (D3) |
| `SettingsPage`, `SettingsSection`, `DangerZone`, `DangerAction` | `settings-page.tsx` | A Settings tab or settings page (D3, F-17) |
| `useUnsavedChangesGuard` | `unsaved-guard.tsx` | Any other page with a `SaveBar` |
| `ListPage`, `useListFilters`, `timeColumn`, `RelativeTime` | `list-page.tsx` | Every list and log (D5) |
| `RecordSheet`, `useRecordParam` | `record-sheet.tsx` | Leaf records: documents, keys, requests, audit entries, crawl runs, models… (D4) |
| `GuardedSheet`, `useCloseGuard`, `useEditTracker` | `close-guard.tsx` | Any other sheet or dialog with a form: "Leave without saving?" on close (m7) |
| `DateRangeFilter`, `useDateRangeParam` | `date-range-filter.tsx` | Any date range (Q13) |
| `ActionMenu`, `orderActions` | `action-menu.tsx` | The "…" menu (used by the above) |

Words come from `src/lib/terms.ts` (D8): "Passages", not chunks; "Signed-in users"; "Danger zone"; Enabled/Disabled for switchable objects and Active/Retired/Archived/Suspended for lifecycle states.

## DetailPage

```tsx
<DetailPage
  title={source.name}
  meta={<StatusBadge …/>}
  facts={[{ label: "Type", value: "Web" }, { label: "Documents", value: plural(n, "document") }, { label: "Last sync", value: <RelativeTime value={…} /> }]}
  primaryAction={<Button>Sync now</Button>}
  menuActions={[{ label: "Pause", icon: <Pause />, onSelect: pause }, { label: "Delete source", danger: true, onSelect: () => setDeleting(true) }]}
  notices={<ArchivedNotice />}
  tabIds={sourceTabs}                // from lib/tabs.ts, validated by the route with tabSearch()
  tabsLabel="Source sections"
  tabs={[{ value: "overview", label: "Overview", content: … }, { value: "documents", label: "Documents", content: … }, { value: "settings", label: "Settings", content: <SourceSettings /> }]}
/>
```

- One primary action at most. Everything else goes in the "…" menu, and destructive actions are always placed last. Give a disabled action a `disabledReason` (P-04).
- Facts with an empty value are dropped. Keep them short: the line wraps.
- The tab lives in `?tab=`, and `"settings"` is always moved to the end. Stat cards belong in the Overview tab only.
- The breadcrumb follows the tab automatically (PageTabs sets the crumb tail; see `components/layout/crumb-tail.ts`). For a nested `PageTabs` inside a tab, pass `crumb="none"`.
- The route must declare the tabs: `teamTabs("sources/$sourceId", sourceTabs, …)`. If the page also uses `?record=` or list filters, use `tabSearch(tabs, { passthrough: true })`, or the router drops those parameters.

## SettingsPage

```tsx
<SettingsPage dirty={changed} saving={save.isPending} error={save.error} saveLabel="Save settings"
  onSave={() => save.mutate(form)} onDiscard={reset} canEdit={canEdit}
  message={invalid ? "Not saved: fix the highlighted field" : undefined} saveDisabled={invalid}>
  <SettingsSection title="General" description="…">…fields…</SettingsSection>
  <SettingsSection title="Crawling">…</SettingsSection>
  <DangerZone>
    <DangerAction title="Pause this source" description="…" action={<Button variant="secondary">Pause</Button>} />
    <DangerAction title="Delete this source" description="…" action={<Button variant="danger" onClick={…}>Delete source</Button>} />
  </DangerZone>
</SettingsPage>
```

- There is one form and **one** sticky save bar per page. Don't add Save buttons to sections.
- The unsaved-changes guard is built in. Leaving the page (a link, the sidebar or Back) asks "Leave without saving?", and closing the tab gets the browser prompt. Switching `?tab=` on the same page isn't blocked; pass `guard={{ samePath: true }}` when each tab holds its own form.
- Danger-zone actions aren't part of the save: each one opens its own confirmation (`AlertDialog` / `ConfirmMutationDialog`). Use `disabledReason` when an action can't run, for example "You're the only owner".
- Field errors need text, not only a red border (F-05). Pass `error="…"` to `Field` and keep `invalid` in sync.

## ListPage

```tsx
<ListPage<Source>
  id="team-sources"                  // remembers hidden columns per list
  title="Data sources" primaryAction={<Button>New source</Button>}
  caption="Data sources" columns={columns} data={rows} getRowId={(r) => r.id} rowLabel={(r) => r.name}
  facets={[{ id: "status", label: "Status", type: "toggle", allLabel: "All", accessor: (r) => r.status, options }]}
  search={{ label: "Search sources" }}
  rowActions={(r) => [{ label: "Open", render: <Link … /> }, { label: "Delete", danger: true, onSelect: … }]}
  empty={{ icon: <Database />, title: "No data sources yet.", action: <Button>New source</Button> }}
  loading={q.isLoading} error={q.error} onRetry={q.refetch}
/>
```

- Filters (`?status=failed`) and search (`?q=`) live in the URL and replace the history entry. Date facets use the same presets as `DateRangeFilter`.
- Filtering is in memory by default. For server-side lists, read the values with `useListFilters(facets)`, pass them to the query, and set `manual` (plus `tableProps={{ loadMore }}` or `cursor`).
- Dates use `timeColumn(id, header, get)` or `<RelativeTime value=…/>`, which show relative text with the full date as the title.
- Rows that open a RecordSheet get `onRowClick={(r) => record.open(r.id)}`: a click anywhere on the row (except its links and buttons) or Enter on the focused row opens it. Keep "View details" in the row menu too.
- Fit at 1280 px: the list sits in a 976 px column there. Give long text a one-line `max-width` with an ellipsis (the full text as `title`), keep short cells `nowrap`, and start low-priority columns hidden (`defaultHidden`, still in the Columns menu). A table never widens the page; it scrolls inside its own wrapper only as a last resort.
- Without `title`, only the table renders (for a list inside a tab or card).
- `tableProps` passes anything else to `DataTable`: `selectable`, `bulkActions`, `toolbar`, `loadMore`, `cursor`, `defaultSort`, `stickyHeader`.

## RecordSheet

```tsx
const record = useRecordParam();         // ?record=<id>
…rowActions={(d) => [{ label: "View details", onSelect: () => record.open(d.id) }, …]}
…onRowClick={(d) => record.open(d.id)}
<RecordSheet open={Boolean(record.id)} onClose={record.close} title={doc.data?.title ?? "Document"}
  description="A document in this source." loading={doc.isLoading} error={doc.error}
  facts={[{ label: "Status", value: … }, { label: "Size", value: … }]}
  sections={[{ title: "Passages", content: … }, { title: "Tags", content: … }]}
  footer={<><Button variant="danger">Delete</Button><Button>Re-fetch</Button></>} />
```

- The sheet is large (`lg`) by default and opens from the right.
- `open(id)` pushes a history entry, so Back closes the sheet, and × goes back too. A pasted link with `?record=` opens the sheet directly.
- Fetch the record by id (not from the list's page), so links work for rows that aren't loaded.
- A sheet holding a form passes `dirty` (e.g. the fourth value of `useFormState`): Escape, the backdrop, × and Cancel then ask "Leave without saving?". Other form sheets use `GuardedSheet` with `useEditTracker()` (any typed or picked field counts); `FormDialog` does this by itself.

## DateRangeFilter

```tsx
const range = useDateRangeParam({ defaultPreset: "30d" });   // ?range=7d or ?range=2026-09-01/2026-09-26
<DateRangeFilter range={range} />
query: { from: range.fromDay, to: range.toDay }                  // date-only APIs (inclusive)
query: { from: range.from?.toISOString(), to: range.toExclusive?.toISOString() }   // RFC 3339 APIs
```

With a `defaultPreset` the default stays out of the URL and the range can't be cleared. Without one, clearing means "any time".

## Shell pieces for pages

- `useCrumbTail(label)` (`components/layout/crumb-tail.ts`) sets the last breadcrumb, for example a record name. PageTabs calls it for tabs.
- `NotFoundState` (`components/not-found.tsx`) renders the not-found page for an unknown team or object id. Use it instead of an inline error when the API returns 404.
- The team section of the sidebar, the team switcher and the ⌘K palette are handled by the shell. Pages don't need to register anything.
