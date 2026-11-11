/* Connector sources (docs/source-types.md): the settings form built from a type's schema, adding a source, its syncs,
 * the review of removals a sync held, the Connection card, and the platform's switch per source type. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { SourceTypeSwitches } from "../pages/admin/settings/source-types";
import { CreateSourcePage, SourceTypeDialog } from "../pages/sources/create";
import { SourceDetail } from "../pages/sources/detail";
import { initialValues, schemaFields, settingsBody, validateSettings } from "../pages/sources/schema-form";
import { stoppedText } from "../pages/sources/syncs";
import { kindOf, typeName } from "../pages/sources/types";
import { builtInSourceTypes } from "./source-types";
import { ApiFailure, common, mockApi, renderWith, webSource } from "./web-harness";

const schema = {
  type: "object",
  required: ["site"],
  "x-order": ["site", "folders", "depth", "kind", "includeArchived", "notes"],
  properties: {
    notes: { type: "string", title: "Notes", "x-multiline": true },
    includeArchived: { type: "boolean", title: "Include archived items", default: false },
    kind: { type: "string", title: "Library kind", enum: ["documents", "pages"], default: "documents" },
    depth: { type: "integer", title: "Folder depth", minimum: 1, maximum: 10, default: 3 },
    folders: { type: "array", items: { type: "string" }, title: "Folders", description: "Only these folders" },
    site: { type: "string", title: "Site address", description: "The site to index" },
    nested: { type: "object" },
  },
};

const drive: Schemas["SourceType"] = {
  key: "test_drive",
  name: "Team Drive",
  description: "Documents from a team drive",
  builtIn: false,
  enabled: true,
  capabilities: { uploads: false, sync: true, webPages: false, permissions: "provider", shared: false },
  configSchema: schema,
  credentials: [
    { key: "clientId", label: "Client ID", help: "From the app registration.", secret: false, required: true },
    { key: "secret", label: "Client secret", help: "", secret: true, required: true },
    { key: "tenant", label: "Tenant", help: "", secret: false, required: false },
  ],
};
const types = [...builtInSourceTypes, drive, { ...drive, key: "off_type", name: "Switched off", enabled: false }];

const sync = (extra: Partial<Schemas["SourceSync"]> = {}): Schemas["SourceSync"] => ({
  id: "y1", sourceId: "s1", status: "completed", trigger: "manual", full: false, complete: false,
  itemsAdded: 0, itemsChanged: 0, itemsUnchanged: 0, itemsSkipped: 0, itemsRemoved: 0, permissionsChanged: 0,
  removals: "", removalsPending: 0, removalsReason: "", stoppedReason: "", error: "", problems: [],
  createdAt: "2026-11-10T10:00:00Z", startedAt: "2026-11-10T10:00:01Z", finishedAt: "2026-11-10T10:00:31Z",
  ...extra,
});

const source = (extra: Partial<Schemas["DataSource"]> = {}) =>
  webSource({
    type: "test_drive", web: null, name: "HR drive", revision: 7, lastSyncAt: "2026-11-10T10:00:31Z", nextSyncAt: null,
    connector: { schedule: "daily", config: { site: "hr.example.org", depth: 3, kind: "documents", includeArchived: false }, credentialKeys: ["clientId", "secret"],
      credentialsSetAt: "2026-11-01T09:00:00Z", lastCompleteAt: "2026-11-10T10:00:31Z", available: true },
    activeSync: null, heldSync: null,
    ...extra,
  });

const routes = (src: Schemas["DataSource"], extra: Record<string, (body?: unknown) => unknown> = {}) => ({
  ...common,
  "GET /v1/source-types": () => types,
  "GET /v1/teams/registrar/sources/s1": () => src,
  "GET /v1/teams/registrar/sources/s1/documents": () => ({ items: [], nextCursor: null }),
  "GET /v1/teams/registrar/sources/s1/tags": () => [],
  "GET /v1/teams/registrar/kbs": () => [],
  "GET /v1/teams/registrar/sources/s1/syncs": () => [sync()],
  ...extra,
});

describe("a connector's settings form", () => {
  it("builds fields from the schema, in the order it gives", () => {
    const fields = schemaFields(schema);
    expect(fields.map((f) => [f.key, f.kind, f.required])).toEqual([
      ["site", "text", true], ["folders", "list", false], ["depth", "number", false], ["kind", "choice", false],
      ["includeArchived", "boolean", false], ["notes", "multiline", false],
    ]);
    expect(schemaFields(undefined)).toEqual([]);
    expect(schemaFields({ properties: { b: { type: "string" }, a: { type: "string" } } }).map((f) => [f.key, f.label])).toEqual([["a", "A"], ["b", "B"]]);
  });

  it("starts from defaults or what is stored, validates, and sends only what is set", () => {
    const fields = schemaFields(schema);
    const fresh = initialValues(fields);
    expect(fresh).toEqual({ site: "", folders: [], depth: "3", kind: "documents", includeArchived: false, notes: "" });
    expect(validateSettings(fields, fresh)).toEqual({ site: "Enter site address." });
    expect(validateSettings(fields, { ...fresh, site: "x", depth: "0" })).toEqual({ depth: "Enter 1 or more." });
    expect(validateSettings(fields, { ...fresh, site: "x", depth: "2.5" })).toEqual({ depth: "Enter a whole number." });
    expect(validateSettings(fields, { ...fresh, site: "x", depth: "11" })).toEqual({ depth: "Enter 10 or less." });
    expect(settingsBody(fields, { ...fresh, site: " hr.example.org ", folders: ["Policies"], depth: "", notes: "" })).toEqual({
      site: "hr.example.org", folders: ["Policies"], kind: "documents", includeArchived: false,
    });
    expect(initialValues(fields, { site: "a", depth: 5, includeArchived: true, folders: ["x"] })).toMatchObject({ site: "a", depth: "5", includeArchived: true, folders: ["x"] });
  });

  it("names types and says why a sync stopped", () => {
    expect([kindOf("upload"), kindOf("web"), kindOf("test_drive")]).toEqual(["upload", "web", "connector"]);
    expect([typeName(types, "web"), typeName(types, "test_drive"), typeName(types, "gone"), typeName(undefined, "upload")]).toEqual(["Website", "Team Drive", "gone", "Upload"]);
    expect(stoppedText("")).toBeUndefined();
    expect(stoppedText("limit:documents")).toMatch(/documents limit/);
    expect(stoppedText("type_off")).toMatch(/turned this source type off/);
  });
});

describe("adding a connector source", () => {
  it("offers the types that are on", async () => {
    mockApi({ ...common, "GET /v1/source-types": () => types });
    const picked: string[] = [];
    renderWith(<SourceTypeDialog onClose={() => {}} onPick={(t) => picked.push(t)} />, { role: "editor" });
    expect(await screen.findByRole("radio", { name: /Team Drive/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Upload files/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Website/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Switched off/ })).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: /Team Drive/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(picked).toEqual(["test_drive"]);
  });

  it("tests the connection, then creates the source with its settings, credentials and schedule", async () => {
    const calls = mockApi({
      ...common,
      "GET /v1/source-types": () => types,
      "POST /v1/teams/registrar/source-types/test_drive/check": () => ({
        summary: "Signed in as the Grounded app.", reachable: [{ id: "hr", name: "Human Resources", kind: "site" }, { id: "it", name: "IT", kind: "site" }],
      }),
      "POST /v1/teams/registrar/sources": () => source({ activeSync: sync({ status: "queued", trigger: "create", full: true }) }),
    });
    const { container } = renderWith(<CreateSourcePage type="test_drive" onClose={() => {}} />, { role: "editor" });
    expect(await screen.findByRole("heading", { name: "New Team Drive source" })).toBeInTheDocument();
    expect(screen.getByText(/readable by the people and groups Team Drive names/)).toBeInTheDocument();
    const test = screen.getByRole("button", { name: "Test connection" });
    expect(test).toBeDisabled();

    // Nothing is sent while a required field is empty.
    await userEvent.click(screen.getByRole("button", { name: "Create and start sync" }));
    expect(await screen.findByText("Enter site address.")).toBeInTheDocument();
    expect(screen.getByText("Enter client secret.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "HR drive");
    await userEvent.type(screen.getByRole("textbox", { name: "Site address" }), "hr.example.org");
    await userEvent.type(screen.getByRole("textbox", { name: "Client ID" }), "app-123");
    const secret = screen.getByLabelText("Client secret");
    expect(secret).toHaveAttribute("type", "password");
    await userEvent.type(secret, "s3cret-value");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sync" }), "weekly");
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(test);
    expect(await screen.findByText("The connection works")).toBeInTheDocument();
    expect(screen.getByText(/Human Resources/)).toBeInTheDocument();
    const check = calls.find((c) => c.url.endsWith("/check"));
    expect(check?.body).toEqual({ config: { site: "hr.example.org", depth: 3, kind: "documents", includeArchived: false }, credentials: { clientId: "app-123", secret: "s3cret-value" } });

    await userEvent.click(screen.getByRole("button", { name: "Create and start sync" }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url === "/v1/teams/registrar/sources");
      expect(post?.body).toMatchObject({
        name: "HR drive", type: "test_drive",
        connector: { config: { site: "hr.example.org", depth: 3, kind: "documents", includeArchived: false }, credentials: { clientId: "app-123", secret: "s3cret-value" }, schedule: "weekly" },
      });
    });
  });

  it("says when the connection doesn't work, and when the type isn't available", async () => {
    mockApi({
      ...common,
      "GET /v1/source-types": () => types,
      "POST /v1/teams/registrar/source-types/test_drive/check": () => new ApiFailure(422, "credentials_refused", "The provider refused the credentials"),
    });
    renderWith(<CreateSourcePage type="test_drive" onClose={() => {}} />, { role: "editor" });
    await userEvent.type(await screen.findByRole("textbox", { name: "Site address" }), "hr.example.org");
    await userEvent.type(screen.getByRole("textbox", { name: "Client ID" }), "app-123");
    await userEvent.type(screen.getByLabelText("Client secret"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("The connection didn't work")).toBeInTheDocument();
    expect(screen.getByText("The provider refused the credentials")).toBeInTheDocument();
  });

  it("refuses a type that is off", async () => {
    mockApi({ ...common, "GET /v1/source-types": () => types });
    renderWith(<CreateSourcePage type="off_type" onClose={() => {}} />, { role: "editor" });
    expect(await screen.findByText("This source type isn't available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create and start sync" })).toBeDisabled();
  });
});

describe("a connector source's page", () => {
  it("shows its type, schedule and sync history, and starts a sync", async () => {
    const started = sync({ id: "y2", status: "queued", full: true });
    const calls = mockApi(
      routes(source(), {
        "GET /v1/teams/registrar/sources/s1/syncs": () => [
          sync({ itemsAdded: 12, itemsChanged: 3, itemsUnchanged: 40, itemsSkipped: 2, itemsRemoved: 1, permissionsChanged: 4,
            problems: [{ id: "f9", title: "logo.png", reason: "This kind of file is not indexed" }] }),
          sync({ id: "y0", status: "failed", error: "The provider refused the credentials. Enter new ones in the source's settings." }),
          sync({ id: "yz", stoppedReason: "limit:documents" }),
        ],
        "POST /v1/teams/registrar/sources/s1/syncs": () => started,
      }),
    );
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    expect(await screen.findByRole("heading", { name: "HR drive" })).toBeInTheDocument();
    expect(await screen.findByText("Team Drive")).toBeInTheDocument();
    expect(screen.getByText("Daily")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload files/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Crawls/ })).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: /Syncs/ }));
    const table = await screen.findByRole("table", { name: "Sync history" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText(/refused the credentials/)).toBeInTheDocument();
    expect(within(table).getByText(/documents limit/)).toBeInTheDocument();
    expect(within(table).getByText("Permissions changed on 4")).toBeInTheDocument();
    expect(within(table).getByText(/logo.png/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Sync everything" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/syncs"))?.body).toEqual({ full: true }));
    expect(await screen.findByText("Sync started")).toBeInTheDocument();
  });

  it("shows a running sync and cancels it", async () => {
    const running = sync({ id: "y3", status: "running", finishedAt: null, itemsAdded: 5, itemsUnchanged: 20 });
    const calls = mockApi(
      routes(source({ activeSync: running }), { "POST /v1/teams/registrar/sources/s1/syncs/y3/cancel": () => sync({ id: "y3", status: "cancelled", stoppedReason: "cancelled" }) }),
    );
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    expect(await screen.findByText("Sync in progress")).toBeInTheDocument();
    expect(screen.getByText("25 items checked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sync now/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel sync" }));
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: "Cancel this sync?" })).getByRole("button", { name: "Cancel sync" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/syncs/y3/cancel"))).toBe(true));
  });

  it("reviews removals a sync held, and confirms or keeps them", async () => {
    const held = sync({ id: "y4", complete: true, removals: "pending", removalsPending: 120, removalsReason: "The sync would remove 120 of this source's 300 documents, more than 30%." });
    const answer = { sync: held, documents: [{ id: "d1", title: "Leave policy", filename: "leave.docx", url: "" }, { id: "d2", title: "", filename: "travel.pdf", url: "" }] };
    const calls = mockApi(
      routes(source({ heldSync: held }), {
        "GET /v1/teams/registrar/sources/s1/syncs/y4/removals": () => answer,
        "POST /v1/teams/registrar/sources/s1/syncs/y4/removals": () => sync({ id: "y4", removals: "confirmed", itemsRemoved: 120 }),
      }),
    );
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    expect(await screen.findByText("The last sync would remove 120 documents, so it removed nothing")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove 120 documents?" });
    expect(await within(dialog).findByText("Leave policy")).toBeInTheDocument();
    expect(within(dialog).getByText("travel.pdf")).toBeInTheDocument();
    expect(within(dialog).getByText("and 118 more.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Keep them" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove 120 documents" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/removals"))?.body).toEqual({ confirm: true }));
    expect(await screen.findByText("Documents removed")).toBeInTheDocument();
  });

  it("lets a member see a held sync without deciding it", async () => {
    const held = sync({ id: "y4", removals: "pending", removalsPending: 3, removalsReason: "The sync found none of this source's documents in the provider, so removing them would empty the source." });
    mockApi(routes(source({ heldSync: held })));
    renderWith(<SourceDetail sourceId="s1" />, { role: "member" });
    expect(await screen.findByText(/so it removed nothing/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sync now/ })).toBeNull();
  });

  it("changes the connection: only what changed is sent, and stored credentials are never shown", async () => {
    const calls = mockApi(routes(source(), { "PUT /v1/teams/registrar/sources/s1/connector": () => source({ revision: 8 }) }));
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /Settings/ }));
    const site = await screen.findByRole("textbox", { name: "Site address" });
    expect(site).toHaveValue("hr.example.org");
    const secret = screen.getByLabelText("Client secret");
    expect(secret).toHaveValue("");
    expect(secret).toHaveAttribute("placeholder", "Stored");
    const save = screen.getByRole("button", { name: "Save connection" });
    expect(save).toBeDisabled();
    await userEvent.type(secret, "rotated-secret");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sync" }), "hourly");
    await userEvent.click(save);
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put?.body).toEqual({ credentials: { secret: "rotated-secret" }, schedule: "hourly" });
      expect(put?.headers.get("If-Match")).toBe('"7"');
    });
    expect(await screen.findByText("Connection saved")).toBeInTheDocument();
  });

  it("says the provider decides access, and that a missing connector can't sync", async () => {
    mockApi(routes(source({ connector: { ...source().connector!, available: false } })));
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /Access/ }));
    expect(await screen.findByText("This source's permissions come from its provider")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sync now/ })).toBeDisabled();
    expect(screen.getByText(/doesn't have this source's connector, so it can't sync/)).toBeInTheDocument();
  });
});

describe("Admin → Settings › Features › Source types", () => {
  it("turns a connector type on, and asks before turning a type off", async () => {
    const list = types.map((t) => ({ ...t, sources: t.key === "web" ? 4 : 0 }));
    const calls = mockApi({
      "GET /v1/source-types": () => list,
      "PUT /v1/admin/source-types/off_type": () => ({ ...list[3]!, enabled: true }),
      "PUT /v1/admin/source-types/web": () => ({ ...list[1]!, enabled: false }),
    });
    const { container } = renderWith(<SourceTypeSwitches isAdmin />, { platformRole: "platform_admin" });
    const off = await screen.findByRole("switch", { name: "Allow Switched off sources" });
    expect(off).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Allow Website sources" })).toBeChecked();
    expect(screen.getByText(/4 sources\./)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(off);
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/off_type"))?.body).toEqual({ enabled: true }));
    expect(await screen.findByText("Switched off sources are on")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: "Allow Website sources" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Turn Website sources off?" });
    expect(calls.some((c) => c.url.endsWith("/web"))).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/web"))?.body).toEqual({ enabled: false }));
  });

  it("is read-only for auditors", async () => {
    const calls = mockApi({ "GET /v1/source-types": () => types });
    renderWith(<SourceTypeSwitches isAdmin={false} />, { platformRole: "platform_auditor" });
    const sw = await screen.findByRole("switch", { name: "Allow Website sources" });
    expect(sw).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(sw);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});
