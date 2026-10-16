/* Webhooks (v0.6.0, F3) for platform admins: the Features switch, Admin → Webhooks (approved destinations, platform webhooks), auditors, and the audit wording. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { areaOf, areaOptions, entryTitle } from "../components/audit/labels";
import { targetTypeLabel } from "../components/audit/target-type-labels";
import { type Handler, Reply, mockApi, renderApp, shellRoutes } from "./harness";
import { type Store, catalogRoutes, delivery, destinations, hook, webhookRoutes, webhookSettings } from "./webhooks-fixtures";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const slow = { timeout: scaled(5000) };
const base = "/v1/admin/webhooks";
const url = "https://hooks.example.edu/platform";

describe("Admin → Settings › Features › Webhooks", () => {
  const featureRoutes = (role: "platform_admin" | "platform_auditor", st = webhookSettings()): Record<string, Handler> => ({
    ...shellRoutes(role),
    "GET /v1/admin/settings/webhooks": () => st,
  });

  it("turns webhooks on with the settings' revision, and asks before turning them off", async () => {
    const calls = mockApi({
      ...featureRoutes("platform_admin", webhookSettings({ enabled: false })),
      "PUT /v1/admin/settings/webhooks": (b) => webhookSettings({ ...(b as object), revision: 5 }),
    });
    renderApp("/admin/settings");
    const sw = await screen.findByRole("switch", { name: "Allow webhooks" }, slow);
    expect(sw).not.toBeChecked();
    await userEvent.click(sw);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ enabled: true });
    expect(calls.find((c) => c.method === "PUT")?.headers.get("If-Match")).toBe('"4"');
    await waitFor(() => expect(screen.getByRole("switch", { name: "Allow webhooks" })).toBeChecked());
    // Team settings' tab follows the capability, so the person is read again.
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.url === "/v1/me").length).toBeGreaterThan(1));

    await userEvent.click(screen.getByRole("switch", { name: "Allow webhooks" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("nothing is sent");
    expect(dialog).toHaveTextContent("kept");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(screen.getByRole("switch", { name: "Allow webhooks" })).toBeChecked();

    await userEvent.click(screen.getByRole("switch", { name: "Allow webhooks" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Turn webhooks off" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    const off = calls.filter((c) => c.method === "PUT").at(-1)!;
    expect(off.body).toEqual({ enabled: false });
    expect(off.headers.get("If-Match")).toBe('"5"');
    await waitFor(() => expect(screen.getByRole("switch", { name: "Allow webhooks" })).not.toBeChecked());
  });

  it("is off by default, links to the destinations, and is read only for an auditor", async () => {
    mockApi(featureRoutes("platform_auditor", webhookSettings({ enabled: false })));
    const { container } = renderApp("/admin/settings");
    const sw = await screen.findByRole("switch", { name: "Allow webhooks" }, slow);
    expect(sw).toHaveAttribute("aria-disabled", "true");
    expect(sw).not.toBeChecked();
    expect(screen.getByRole("link", { name: /Approved destinations/ })).toHaveAttribute("href", "/admin/webhooks");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a failed save and reloads the setting", async () => {
    const calls = mockApi({
      ...featureRoutes("platform_admin", webhookSettings({ enabled: false })),
      "PUT /v1/admin/settings/webhooks": () => Reply.error(412, "revision_conflict"),
    });
    renderApp("/admin/settings");
    await userEvent.click(await screen.findByRole("switch", { name: "Allow webhooks" }, slow));
    expect(await screen.findByText("Couldn't change webhooks")).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.url === "/v1/admin/settings/webhooks").length).toBeGreaterThan(1));
  });
});

/** The destinations the server holds, as a test changes them. */
function adminSetup(role: "platform_admin" | "platform_auditor", opts: { enabled?: boolean; hooks?: Schemas["Webhook"][]; extra?: Record<string, Handler> } = {}) {
  let held = [...destinations];
  const store: Store = { hooks: opts.hooks ?? [hook({ id: "w1", teamId: null, url, events: ["team.created"] })], deliveries: [delivery()], secrets: [] };
  const calls = mockApi({
    ...shellRoutes(role),
    "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
    "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0, pendingTeamRequests: 0 }),
    "GET /v1/admin/settings/webhooks": () => webhookSettings({ enabled: opts.enabled ?? true }),
    ...catalogRoutes(),
    "GET /v1/webhook-destinations": () => held,
    "POST /v1/admin/webhook-destinations": (b) => {
      const input = b as { pattern: string; note?: string };
      const d = { id: "x9", pattern: input.pattern, note: input.note ?? "", createdAt: "2026-10-16T09:00:00Z" };
      held = [...held, d];
      return new Reply(201, { data: d });
    },
    "DELETE /v1/admin/webhook-destinations/x1": () => {
      held = held.filter((d) => d.id !== "x1");
      return { ok: true };
    },
    ...webhookRoutes(base, store),
    ...opts.extra,
  });
  return { calls, store };
}

describe("Admin → Webhooks › Approved destinations", () => {
  it("lists the destinations, and explains patterns, https on port 443 and private addresses", async () => {
    adminSetup("platform_admin");
    const { container } = renderApp("/admin/webhooks");
    const table = await screen.findByRole("table", { name: "Approved destinations" }, slow);
    expect(await within(table).findByRole("row", { name: /hooks\.example\.edu/ })).toHaveTextContent("Registrar's receiver");
    expect(within(table).getByRole("row", { name: /\*\.example\.org/ })).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "LI" && /\*\.example\.edu covers example\.edu and its subdomains/.test(el.textContent ?? ""))).toBeInTheDocument();
    expect(screen.getByText(/https to port 443 only/)).toBeInTheDocument();
    expect(screen.getByText(/Private, loopback, link-local and cloud metadata addresses are never reachable/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("approves a destination with an optional note, and the table follows", async () => {
    const { calls } = adminSetup("platform_admin");
    renderApp("/admin/webhooks");
    await userEvent.type(await screen.findByRole("textbox", { name: /Host pattern/ }, slow), "*.example.com");
    await userEvent.type(screen.getByRole("textbox", { name: /Note/ }), "Hooks vendor");
    await userEvent.click(screen.getByRole("button", { name: "Approve destination" }));
    const row = await screen.findByRole("row", { name: /\*\.example\.com/ });
    expect(row).toHaveTextContent("Hooks vendor");
    expect(calls.find((c) => c.method === "POST" && c.url === "/v1/admin/webhook-destinations")?.body).toEqual({ pattern: "*.example.com", note: "Hooks vendor" });
    // The form is empty again.
    expect(screen.getByRole("textbox", { name: /Host pattern/ })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /Note/ })).toHaveValue("");
  });

  it("asks for a pattern before sending anything", async () => {
    const { calls } = adminSetup("platform_admin");
    renderApp("/admin/webhooks");
    await userEvent.click(await screen.findByRole("button", { name: "Approve destination" }, slow));
    expect(await screen.findByText(/Enter a host such as/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it.each([
    ["invalid_pattern", 400, /Host pattern/, 'Enter a host such as "hooks.example.edu" or a wildcard such as "*.example.edu"'],
    ["blocked_address", 400, /Host pattern/, "Webhooks are never sent to private, loopback, link-local or cloud metadata addresses"],
    ["destination_exists", 409, /Host pattern/, "That destination is already approved"],
    ["invalid_note", 400, /Note/, "The note must be one line of at most 200 characters"],
  ])("puts the server's %s on its field", async (code, status, field, message) => {
    adminSetup("platform_admin", { extra: { "POST /v1/admin/webhook-destinations": () => Reply.error(status, code, message) } });
    renderApp("/admin/webhooks");
    await userEvent.type(await screen.findByRole("textbox", { name: /Host pattern/ }, slow), "10.0.0.1");
    await userEvent.click(screen.getByRole("button", { name: "Approve destination" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: field })).toHaveAttribute("aria-invalid", "true");
    const other = screen.getByRole("textbox", { name: field.source === "Note" ? /Host pattern/ : /Note/ });
    expect(other).not.toHaveAttribute("aria-invalid", "true");
  });

  it("removes a destination only after confirmation, saying what stops", async () => {
    const { calls } = adminSetup("platform_admin");
    renderApp("/admin/webhooks");
    const table = await screen.findByRole("table", { name: "Approved destinations" }, slow);
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for hooks.example.edu" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove…" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("stop at once");
    expect(dialog).toHaveTextContent("not retried");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(within(table).getByRole("row", { name: /hooks\.example\.edu/ })).toBeInTheDocument();

    await userEvent.click(within(table).getByRole("button", { name: "Actions for hooks.example.edu" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove…" }));
    dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove destination" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/v1/admin/webhook-destinations/x1");
    await waitFor(() => expect(within(table).queryByRole("row", { name: /^hooks\.example\.edu/ })).toBeNull());
    expect(within(table).getByRole("row", { name: /\*\.example\.org/ })).toBeInTheDocument();
  });
});

describe("Admin → Webhooks › Platform webhooks", () => {
  it("lists the platform's webhooks, offers only platform events, and shows the secret once after one is made", async () => {
    const { calls } = adminSetup("platform_admin");
    renderApp("/admin/webhooks");
    const table = await screen.findByRole("table", { name: "Platform webhooks" }, slow);
    expect(await within(table).findByRole("row", { name: new RegExp(url) })).toHaveTextContent("team.created");
    await userEvent.click(screen.getByRole("button", { name: "New webhook" }));
    const dialog = await screen.findByRole("dialog", { name: "New webhook" });
    const events = within(dialog).getByRole("group", { name: "Events" });
    expect(within(events).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(events).getByRole("checkbox", { name: /team\.created/ })).toBeInTheDocument();
    expect(within(events).getByRole("checkbox", { name: /team_request\.created/ })).toBeInTheDocument();
    expect(within(events).queryByRole("checkbox", { name: /agent\.published/ })).toBeNull();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Address/ }), "https://hooks.example.edu/second");
    await userEvent.click(within(events).getByRole("checkbox", { name: /team_request\.created/ }));
    await userEvent.click(within(dialog).getByRole("switch", { name: "Turned on" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    const secret = await screen.findByRole("dialog", { name: "Webhook created" });
    expect(within(secret).getByText("whsec_created_secret_9f3c")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST" && c.url === base)?.body).toEqual({ url: "https://hooks.example.edu/second", description: "", events: ["team_request.created"], enabled: false });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body).not.toHaveTextContent("whsec_created_secret_9f3c");
    const row = await screen.findByRole("row", { name: /hooks\.example\.edu\/second/ });
    expect(row).toHaveTextContent("Off");
    expect(row).toHaveTextContent("whsec_…9f3c");
  });

  it("edits, rotates and deletes a platform webhook, each over the platform's own routes", async () => {
    const { calls } = adminSetup("platform_admin");
    renderApp("/admin/webhooks");
    const menu = async (item: string) => {
      await userEvent.click(await screen.findByRole("button", { name: `Actions for ${url}` }, slow));
      await userEvent.click(await screen.findByRole("menuitem", { name: item }));
    };
    await menu("Edit…");
    const dialog = await screen.findByRole("dialog", { name: "Edit webhook" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Description/ }), " (platform)");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save webhook" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit webhook" })).toBeNull());
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe(`${base}/w1`);
    expect(patch.headers.get("If-Match")).toBe('"3"');

    await menu("Rotate secret…");
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Rotate secret" }));
    const secret = await screen.findByRole("dialog", { name: "New webhook secret" });
    expect(within(secret).getByText("whsec_rotated_secret_7d0e")).toBeInTheDocument();
    await userEvent.click(within(secret).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await menu("Delete…");
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete webhook" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === `${base}/w1`)).toBe(true));
    await waitFor(() => expect(screen.queryByRole("row", { name: new RegExp(url) })).toBeNull());
    expect(calls.some((c) => c.url.startsWith("/v1/teams/"))).toBe(false);
  });

  it("says webhooks are off, links to the switch, and offers no create or send, while destinations and what exists stay", async () => {
    adminSetup("platform_admin", { enabled: false });
    renderApp("/admin/webhooks");
    const note = await screen.findByText("Webhooks are turned off", undefined, slow);
    expect(note.closest("[role]") ?? note.parentElement).toHaveTextContent("nothing is sent until they are turned on");
    expect(screen.getByRole("link", { name: "Admin → Settings → Features" })).toHaveAttribute("href", "/admin/settings");
    expect(screen.queryByRole("button", { name: "New webhook" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve destination" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: `Actions for ${url}` }));
    expect(await screen.findByRole("menuitem", { name: "Deliveries…" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Rotate secret…" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Edit…" })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: "Deliveries…" }));
    const panel = await screen.findByRole("dialog", { name: "Deliveries" });
    expect(await within(panel).findByRole("row", { name: /agent\.published/ })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Send test event" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Redeliver/ })).toBeNull();
  });

  it("shows no note while the switch is still unread, and no create either", async () => {
    adminSetup("platform_admin", { extra: { "GET /v1/admin/settings/webhooks": () => new Promise(() => {}) } });
    renderApp("/admin/webhooks");
    await screen.findByRole("table", { name: "Platform webhooks" }, slow);
    expect(screen.queryByText("Webhooks are turned off")).toBeNull();
    expect(screen.queryByRole("button", { name: "New webhook" })).toBeNull();
  });
});

describe("a platform auditor", () => {
  it("reads the destinations, the webhooks and their deliveries, and changes nothing", async () => {
    adminSetup("platform_auditor");
    const { container } = renderApp("/admin/webhooks");
    expect(await screen.findByText(/Auditors can view webhooks and their deliveries/, undefined, slow)).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Platform webhooks" });
    expect(await within(table).findByRole("row", { name: new RegExp(url) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New webhook" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve destination" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Host pattern/ })).toBeNull();
    // The destinations' rows have no menu: there is nothing to do with them.
    expect(screen.queryByRole("button", { name: "Actions for hooks.example.edu" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: `Actions for ${url}` }));
    expect(await screen.findAllByRole("menuitem")).toHaveLength(1);
    await userEvent.click(screen.getByRole("menuitem", { name: "Deliveries…" }));
    const panel = await screen.findByRole("dialog", { name: "Deliveries" });
    expect(await within(panel).findByRole("row", { name: /agent\.published/ })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Send test event" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Redeliver/ })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("audit log wording", () => {
  it("names the webhook actions, their areas and their targets", () => {
    const e = (action: string) => ({ action, after: null, targetLabel: "hooks.example.edu" });
    expect(entryTitle(e("webhook.create"))).toBe("Made a webhook: hooks.example.edu");
    expect(entryTitle(e("webhook.update"))).toBe("Changed a webhook: hooks.example.edu");
    expect(entryTitle(e("webhook.rotate_secret"))).toBe("Rotated a webhook's secret: hooks.example.edu");
    expect(entryTitle(e("webhook.delete"))).toBe("Deleted a webhook: hooks.example.edu");
    expect(entryTitle(e("webhook.test"))).toBe("Sent a webhook test event: hooks.example.edu");
    expect(entryTitle(e("webhook.redeliver"))).toBe("Sent a webhook delivery again: hooks.example.edu");
    expect(entryTitle(e("webhook_destination.create"))).toBe("Approved a webhook destination: hooks.example.edu");
    expect(entryTitle(e("webhook_destination.delete"))).toBe("Removed a webhook destination: hooks.example.edu");
    expect(entryTitle(e("platform.webhooks"))).toBe("Turned webhooks on or off: hooks.example.edu");
    expect(areaOf("webhook.rotate_secret")).toBe("Webhooks");
    expect(areaOf("webhook_destination.create")).toBe("Webhook destinations");
    expect(areaOf("platform.webhooks")).toBe("Platform settings");
    // Destinations are the platform log's; webhooks are in the team's log too.
    expect(areaOptions(false).some((o) => o.value === "webhook.")).toBe(true);
    expect(areaOptions(false).some((o) => o.value === "webhook_destination.")).toBe(false);
    expect(areaOptions(true).some((o) => o.value === "webhook_destination.")).toBe(true);
    expect(targetTypeLabel("webhook")).toBe("Webhook");
    expect(targetTypeLabel("webhook_destination")).toBe("Webhook destination");
    expect(targetTypeLabel("webhook_settings")).toBe("Webhooks setting");
  });

  it("shows the switch's change as On or Off", async () => {
    const entry: Schemas["AuditEntry"] = {
      id: 3,
      occurredAt: "2026-10-15T09:00:00Z",
      actorKind: "user",
      actor: { kind: "user", userId: "u1", displayName: "Una User", email: "una@example.edu" },
      action: "platform.webhooks",
      targetType: "webhook_settings",
      targetId: "settings",
      targetLabel: "Webhooks",
      targetExists: true,
      before: { enabled: false },
      after: { enabled: true },
      metadata: {},
      requestId: "r1",
    };
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/audit": () => ({ items: [entry], nextCursor: null }) });
    renderApp("/admin/logs");
    const row = await screen.findByRole("row", { name: /Turned webhooks on or off/ }, slow);
    expect(row).toHaveTextContent("Webhooks");
    expect(row.querySelector("a")).toHaveAttribute("href", "/admin/settings");
  });
});
