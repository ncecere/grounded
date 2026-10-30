/* Webhooks (v0.6.0, F3) in Team settings: who sees the tab, the list and its statuses, making a webhook (the secret once), changing, rotating and deleting one. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Reply, mockApi, renderApp } from "./harness";
import { type Store, hook, teamSettingsRoutes, webhookRoutes } from "./webhooks-fixtures";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const base = "/v1/teams/registrar/webhooks";
const url = "https://hooks.example.edu/grounded";
const slow = { timeout: scaled(5000) };

/** A team whose server holds `hooks`, shown to a member with `teamRole`. */
function setup(hooks = [hook()], teamRole = "owner", opts: Parameters<typeof webhookRoutes>[2] = {}) {
  const store: Store = { hooks, deliveries: [], secrets: [] };
  const calls = mockApi({ ...teamSettingsRoutes(teamRole), ...webhookRoutes(base, store, opts) });
  return { store, calls };
}

const rowMenu = async (name = url) => {
  await userEvent.click(await screen.findByRole("button", { name: `Actions for ${name}` }, slow));
};

describe("the Webhooks tab", () => {
  it("is there for team owners and admins while webhooks are on, and ?tab=webhooks lands on it", async () => {
    for (const role of ["owner", "admin"]) {
      mockApi({ ...teamSettingsRoutes(role), ...webhookRoutes(base, { hooks: [hook()], deliveries: [], secrets: [] }) });
      const { unmount } = renderApp("/teams/registrar/settings?tab=webhooks");
      const tab = await screen.findByRole("tab", { name: "Webhooks" }, slow);
      expect(tab).toHaveAttribute("aria-selected", "true");
      expect(await screen.findByRole("table", { name: "Team webhooks" })).toBeInTheDocument();
      unmount();
    }
  });

  it("is never there for editors and members, and a link to it lands on the first tab without asking for webhooks", async () => {
    for (const role of ["editor", "member"]) {
      const { calls } = setup([hook()], role);
      const { unmount, router } = renderApp("/teams/registrar/settings?tab=webhooks");
      await screen.findByRole("tab", { name: "Members" }, slow);
      expect(screen.queryByRole("tab", { name: "Webhooks" })).toBeNull();
      await waitFor(() => expect(router.state.location.search).not.toHaveProperty("tab"));
      expect(calls.some((c) => c.url === base)).toBe(false);
      unmount();
    }
  });

  it("is hidden while the platform has webhooks off, and when the capability is missing", async () => {
    for (const capability of [false, null]) {
      mockApi({ ...teamSettingsRoutes("owner", capability), ...webhookRoutes(base, { hooks: [], deliveries: [], secrets: [] }) });
      const { unmount } = renderApp("/teams/registrar/settings");
      await screen.findByRole("tab", { name: "Members" }, slow);
      expect(screen.queryByRole("tab", { name: "Webhooks" })).toBeNull();
      unmount();
    }
  });
});

describe("the list", () => {
  it("shows each webhook's address, description, events, status and the end of its secret, and the secret itself never", async () => {
    setup([
      hook({ events: ["agent.published", "source.synced"] }),
      hook({ id: "w2", url: "https://b.example.org/hook", description: "", enabled: false, secretHint: "cd34" }),
      hook({ id: "w3", url: "https://c.example.org/hook", pausedReason: "failing", enabled: false, consecutiveFailures: 5, secretHint: "ef56" }),
      hook({ id: "w4", url: "https://d.example.org/hook", pausedReason: "gone", enabled: false, secretHint: "0a78" }),
      hook({ id: "w5", url: "https://e.example.org/hook", pausedReason: "failing", enabled: false, secretHint: "1b90" }),
    ]);
    const { container } = renderApp("/teams/registrar/settings?tab=webhooks");
    const table = await screen.findByRole("table", { name: "Team webhooks" }, slow);
    const first = await within(table).findByRole("row", { name: new RegExp(url) });
    expect(first).toHaveTextContent("Registrar notifications");
    expect(first).toHaveTextContent("On");
    expect(first).toHaveTextContent("whsec_…ab12");
    const chips = within(first).getByRole("list", { name: `Events of ${url}` });
    expect(within(chips).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["agent.published", "source.synced"]);
    expect(within(table).getByRole("row", { name: /b\.example\.org/ })).toHaveTextContent("Off");
    expect(within(table).getByRole("row", { name: /c\.example\.org/ })).toHaveTextContent("Paused: failing");
    expect(within(table).getByRole("row", { name: /d\.example\.org/ })).toHaveTextContent("Paused: gone");
    // The server turns a webhook off when it pauses it and keeps the reason until it is turned on again: switched off by hand too, it is still Paused.
    expect(within(table).getByRole("row", { name: /e\.example\.org/ })).toHaveTextContent("Paused: failing");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says there are none yet, and offers New webhook", async () => {
    setup([]);
    renderApp("/teams/registrar/settings?tab=webhooks");
    expect(await screen.findByText("No webhooks yet.", undefined, slow)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New webhook" })).toBeInTheDocument();
  });
});

describe("making a webhook", () => {
  const open = async () => {
    renderApp("/teams/registrar/settings?tab=webhooks");
    await userEvent.click(await screen.findByRole("button", { name: "New webhook" }, slow));
    return screen.findByRole("dialog", { name: "New webhook" });
  };

  it("offers the approved destinations and this team's events, and shows the secret once after it is made", async () => {
    const { calls, store } = setup([]);
    const dialog = await open();
    expect(await within(dialog).findByText("hooks.example.edu")).toBeInTheDocument();
    expect(within(dialog).getByText("*.example.org")).toBeInTheDocument();
    const events = within(dialog).getByRole("group", { name: "Events" });
    expect(within(events).getAllByRole("checkbox")).toHaveLength(4);
    expect(within(events).getByRole("checkbox", { name: /agent\.published/ })).toBeInTheDocument();
    expect(within(events).getByText("An agent was published")).toBeInTheDocument();
    // Platform events are not offered to a team.
    expect(within(events).queryByRole("checkbox", { name: /team\.created/ })).toBeNull();
    expect(within(dialog).getByRole("switch", { name: "Turned on" })).toBeChecked();

    await userEvent.type(within(dialog).getByRole("textbox", { name: /Address/ }), ` ${url} `);
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Description/ }), "  Registrar notifications ");
    await userEvent.click(within(events).getByRole("checkbox", { name: /agent\.published/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));

    const secret = await screen.findByRole("dialog", { name: "Webhook created" });
    expect(calls.find((c) => c.method === "POST" && c.url === base)?.body).toEqual({ url, description: "Registrar notifications", events: ["agent.published"], enabled: true });
    expect(within(secret).getByText("whsec_created_secret_9f3c")).toBeInTheDocument();
    expect(secret).toHaveTextContent("It won't be shown again");
    expect(secret).toHaveTextContent("Grounded-Signature");
    expect(secret).toHaveTextContent("five minutes");
    expect(within(secret).getByRole("button", { name: /Copy signing secret/ })).toBeInTheDocument();
    expect(store.secrets).toHaveLength(1);
    expect(await axe(secret)).toHaveNoViolations();

    // Done closes it: the secret is gone from the page, and the list shows only the hint.
    await userEvent.click(within(secret).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText(/whsec_created_secret/)).toBeNull();
    const row = await screen.findByRole("row", { name: new RegExp(url) });
    expect(row).toHaveTextContent("whsec_…9f3c");
    expect(document.body).not.toHaveTextContent("whsec_created_secret_9f3c");
    // Focus returns to the button that made it.
    await waitFor(() => expect(screen.getByRole("button", { name: "New webhook" })).toHaveFocus());
  });

  it("asks for an event when only the address is filled in, and sends nothing", async () => {
    const { calls } = setup([]);
    const dialog = await open();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Address/ }), url);
    await userEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    expect(await within(dialog).findByText("Choose at least one event.")).toBeInTheDocument();
    expect(within(dialog).queryByText("Enter the address the events are sent to.")).toBeNull();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("asks for an address and an event before sending anything, and Cancel makes nothing", async () => {
    const { calls } = setup([]);
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    expect(await within(dialog).findByText("Enter the address the events are sent to.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose at least one event.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New webhook" })).toBeNull());
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it.each([
    ["invalid_url", /Address/, "Enter an https address with a host name"],
    ["invalid_port", /Address/, "Webhooks are sent to port 443 only"],
    ["invalid_host", /Address/, "Use a host name, not an IP address"],
    ["destination_not_approved", /Address/, "That host is not an approved destination"],
    ["invalid_description", /Description/, "The description must be one line"],
  ])("puts the server's %s on its field", async (code, field, message) => {
    setup([], "owner", { reject: () => Reply.error(400, code, message) });
    const dialog = await open();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Address/ }), url);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /agent\.published/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    const input = within(dialog).getByRole("textbox", { name: field });
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    // The other fields are not marked.
    const other = within(dialog).getByRole("textbox", { name: field.source === "Address" ? /Description/ : /Address/ });
    expect(other).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog", { name: "New webhook" })).toBeInTheDocument();
  });

  it("sends the corrected address after the server refused the first (the old error does not block the dialog)", async () => {
    let n = 0;
    const { calls } = setup([], "owner", { reject: () => (++n === 1 ? Reply.error(400, "destination_not_approved", "That host is not an approved destination") : undefined) });
    const dialog = await open();
    const address = within(dialog).getByRole("textbox", { name: /Address/ });
    await userEvent.type(address, "https://hooks.other.org/x");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /agent\.published/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    expect(await within(dialog).findByText("That host is not an approved destination")).toBeInTheDocument();
    await userEvent.clear(address);
    expect(within(dialog).queryByText("That host is not an approved destination")).toBeNull();
    await userEvent.type(address, url);
    await userEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));
    expect(await screen.findByRole("dialog", { name: "Webhook created" })).toBeInTheDocument();
  });

  it.each([
    ["no_events", "Choose at least one event"],
    ["invalid_event", "“team.created” is not an event of this kind of webhook"],
  ])("puts the server's %s on the events", async (code, message) => {
    setup([], "owner", { reject: () => Reply.error(400, code, message) });
    const dialog = await open();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Address/ }), url);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /agent\.published/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Address/ })).not.toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    ["too_many_webhooks", "There are as many webhooks here as allowed: delete one first"],
    ["webhooks_off", "Webhooks are turned off. A platform admin can turn them on under Admin → Settings → Features"],
  ])("shows %s above the buttons, on no field", async (code, message) => {
    setup([], "owner", { reject: () => Reply.error(409, code, message) });
    const dialog = await open();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Address/ }), url);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /agent\.published/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Address/ })).not.toHaveAttribute("aria-invalid", "true");
  });
});

describe("changing a webhook", () => {
  it("saves with the webhook's revision, starts from what it has, and a paused one is started again by saving it turned on", async () => {
    const { calls } = setup([hook({ pausedReason: "failing", enabled: false, consecutiveFailures: 5 })]);
    renderApp("/teams/registrar/settings?tab=webhooks");
    await rowMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit webhook" });
    expect(within(dialog).getByRole("textbox", { name: /Address/ })).toHaveValue(url);
    expect(within(dialog).getByRole("checkbox", { name: /agent\.published/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /source\.synced/ })).not.toBeChecked();
    expect(dialog).toHaveTextContent("Paused: failing");
    expect(dialog).toHaveTextContent("Five deliveries in a row gave up");
    const description = within(dialog).getByRole("textbox", { name: /Description/ });
    await userEvent.clear(description);
    await userEvent.type(description, "Moved to the new receiver");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /source\.synced/ }));
    // It is off: saving as it is would leave it paused, so the person turns it on.
    const on = within(dialog).getByRole("switch", { name: "Turned on" });
    expect(on).not.toBeChecked();
    await userEvent.click(on);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save webhook" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit webhook" })).toBeNull());
    const sent = calls.find((c) => c.method === "PATCH")!;
    expect(sent.url).toBe(`${base}/w1`);
    expect(sent.headers.get("If-Match")).toBe('"3"');
    expect(sent.body).toEqual({ url, description: "Moved to the new receiver", events: ["agent.published", "source.synced"], enabled: true });
    // The list follows, with the pause cleared.
    const row = await screen.findByRole("row", { name: new RegExp(url) });
    await waitFor(() => expect(row).toHaveTextContent("Moved to the new receiver"));
    expect(row).not.toHaveTextContent("Paused");
  });

  it("tells the person that the destination was withdrawn, and still saves it turned off (#140)", async () => {
    const gone = "https://hooks.withdrawn.example.net/grounded";
    const { calls } = setup([hook({ url: gone })]);
    renderApp("/teams/registrar/settings?tab=webhooks");
    await rowMenu(gone);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit webhook" });
    expect(await within(dialog).findByText("This address is no longer an approved destination")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Nothing is sent to it.");
    await userEvent.click(within(dialog).getByRole("switch", { name: "Turned on" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save webhook" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit webhook" })).toBeNull());
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ url: gone, description: "Registrar notifications", events: ["agent.published"], enabled: false });
  });

  it("shows no such notice while a pattern covers the address", async () => {
    setup([hook()]);
    renderApp("/teams/registrar/settings?tab=webhooks");
    await rowMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit webhook" });
    await within(dialog).findByText(/to an approved destination/);
    expect(within(dialog).queryByText("This address is no longer an approved destination")).toBeNull();
  });

  it("keeps what was typed when someone else changed it first, and a second save uses the new revision", async () => {
    const { calls, store } = setup([hook()]);
    renderApp("/teams/registrar/settings?tab=webhooks");
    await rowMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit webhook" });
    const description = within(dialog).getByRole("textbox", { name: /Description/ });
    await userEvent.clear(description);
    await userEvent.type(description, "Mine");
    // Someone else saves first.
    store.hooks[0] = { ...store.hooks[0]!, revision: 4, description: "Theirs" };
    await userEvent.click(within(dialog).getByRole("button", { name: "Save webhook" }));
    expect(await within(dialog).findByText(/Someone else changed this while you were editing/)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Description/ })).toHaveValue("Mine");
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.url === base).length).toBeGreaterThan(1));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save webhook" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit webhook" })).toBeNull());
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.headers.get("If-Match"))).toEqual(['"3"', '"4"']);
    expect(store.hooks[0]!.description).toBe("Mine");
  });

  it("asks before leaving an edit, and Cancel on an unedited form closes it without a request", async () => {
    const { calls } = setup([hook()]);
    renderApp("/teams/registrar/settings?tab=webhooks");
    await rowMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit webhook" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit webhook" })).toBeNull());
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    // Focus is back on the row's menu button.
    await waitFor(() => expect(screen.getByRole("button", { name: `Actions for ${url}` })).toHaveFocus());
  });
});

describe("the secret and deleting", () => {
  it("rotates the secret only after confirmation, then shows the new one once", async () => {
    const { calls } = setup([hook()]);
    renderApp("/teams/registrar/settings?tab=webhooks");
    await rowMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rotate secret…" }));
    let confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("stops working at once");
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls.some((c) => c.url.endsWith("/rotate-secret"))).toBe(false);

    await rowMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rotate secret…" }));
    confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Rotate secret" }));
    const secret = await screen.findByRole("dialog", { name: "New webhook secret" });
    expect(within(secret).getByText("whsec_rotated_secret_7d0e")).toBeInTheDocument();
    expect(secret).toHaveTextContent("The old secret stopped working");
    expect(calls.filter((c) => c.url === `${base}/w1/rotate-secret`)).toHaveLength(1);
    await userEvent.click(within(secret).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body).not.toHaveTextContent("whsec_rotated_secret_7d0e");
    expect(await screen.findByRole("row", { name: new RegExp(url) })).toHaveTextContent("whsec_…7d0e");
  });

  it("deletes a webhook only after confirmation, saying its delivery log goes too", async () => {
    const { calls } = setup([hook(), hook({ id: "w2", url: "https://b.example.org/hook" })]);
    renderApp("/teams/registrar/settings?tab=webhooks");
    await rowMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    let confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("delivery log is deleted too");
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    await rowMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete webhook" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe(`${base}/w1`);
    await waitFor(() => expect(screen.queryByRole("row", { name: new RegExp(url) })).toBeNull());
    expect(screen.getByRole("row", { name: /b\.example\.org/ })).toBeInTheDocument();
  });
});
