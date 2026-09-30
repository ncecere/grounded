/* ⌘K finds objects on the server (E15, GET /v1/search): groups by type, links, debouncing, cancelling and the live status. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { type Call, mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

type Hit = Record<string, unknown>;
const hit = (type: string, id: string, label: string, secondary: string, over: Hit = {}): Hit => ({ type, id, label, secondary, ...over });

const memberHits = [
  hit("agent", "a1", "Registrar assistant", "Office of the Registrar", { teamSlug: "registrar", agentSlug: "registrar-assistant", canOpen: true, canChat: true }),
  hit("agent", "a2", "Registrar campus guide", "Campus Services", { teamSlug: "campus", agentSlug: "guide", canOpen: false, canChat: true }),
  hit("knowledge_base", "k1", "Registrar handbook", "Office of the Registrar", { teamSlug: "registrar" }),
  hit("data_source", "s1", "Registrar website", "Office of the Registrar", { teamSlug: "registrar", kind: "web", status: "paused" }),
  hit("conversation", "c1", "Registrar deadlines", "Registrar assistant", {
    teamSlug: "registrar",
    agentSlug: "registrar-assistant",
    updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  }),
];

const staffHits = [
  hit("team", "t9", "Registrar archive", "reg-archive", { teamSlug: "reg-archive", status: "archived" }),
  hit("user", "u9", "Regina Rivera", "regina@example.edu"),
  hit("model", "m1", "Registrar chat", "reg-chat", { kind: "chat", status: "disabled" }),
  hit("connection", "n1", "Registrar gateway", "https://llm.example.edu/v1"),
  hit("mcp_server", "x1", "Registrar status", "https://status.example.edu/mcp"),
  hit("embedding_profile", "p1", "Registrar vectors", "reg-vectors"),
  hit("shared_source", "ss1", "Registrar policies", "", { kind: "upload" }),
];

async function openPalette() {
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 1 });
  await user.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  return { user, dialog, input: within(dialog).getByRole("combobox", { name: "Command palette" }) };
}

const searches = (calls: Call[]) => calls.filter((c) => c.url === "/v1/search");

describe("command palette search (E15)", () => {
  it("shows the server's results in groups, only for 2+ characters, and opens them", async () => {
    const calls = mockApi({ ...shellRoutes(), "GET /v1/agents": () => [], "GET /v1/search": () => memberHits });
    const { router } = renderApp("/");
    const { user, dialog, input } = await openPalette();

    await user.type(input, "r");
    await new Promise((r) => setTimeout(r, 300));
    expect(searches(calls)).toHaveLength(0);

    await user.type(input, "egistrar");
    const listbox = await within(dialog).findByRole("listbox");
    const group = (name: string) => within(listbox).getByRole("group", { name });
    await within(dialog).findByRole("option", { name: /Registrar handbook/ });
    // An agent the user may edit and chat with appears in both groups; one only to chat with, once.
    expect(within(group("Chat with an agent")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Registrar assistantOffice of the Registrar",
      "Registrar campus guideCampus Services",
    ]);
    expect(within(group("Agents")).getAllByRole("option")).toHaveLength(1);
    expect(within(group("Data sources")).getByRole("option")).toHaveTextContent("Office of the Registrar · Paused");
    // Conversations often share a title: the date tells them apart.
    expect(within(group("Conversations")).getByRole("option")).toHaveTextContent("Registrar deadlinesRegistrar assistant · 3 days ago");
    expect(within(listbox).queryByRole("group", { name: "Users" })).toBeNull();
    // Debounced: one request, for the whole word (a member never gets a request per keystroke).
    expect(searches(calls).map((c) => c.search.get("q"))).toEqual(["registrar"]);

    await user.click(within(group("Conversations")).getByRole("option"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/a/registrar/registrar-assistant"));
    expect(router.state.location.search).toEqual({ c: "c1" });
  });

  it("gives platform staff teams, users, models, connections, profiles and shared sources, linked to their admin pages, without axe violations", async () => {
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/agents": () => [], "GET /v1/search": () => staffHits });
    const { router } = renderApp("/");
    const { user, dialog, input } = await openPalette();
    await user.type(input, "reg");
    await within(dialog).findByRole("option", { name: /Regina Rivera/ });
    const listbox = within(dialog).getByRole("listbox");
    for (const name of ["Teams in Admin", "Users", "Models", "Connections", "MCP servers", "Embedding profiles", "Shared sources"]) {
      expect(within(listbox).getByRole("group", { name })).toBeInTheDocument();
    }
    expect(within(listbox).getByRole("option", { name: /Registrar archive/ })).toHaveTextContent("Admin · Archived");
    expect(within(listbox).getByRole("option", { name: /Registrar chat/ })).toHaveTextContent("Chat model · Disabled");
    expect(await axe(document.body)).toHaveNoViolations();

    // A user's email is searchable in the palette's own filter too.
    await user.clear(input);
    await user.type(input, "regina@");
    await user.click(await within(dialog).findByRole("option", { name: /Regina Rivera/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/users/u9"));
  });

  it("opens models and connections as records on their admin lists", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/agents": () => [], "GET /v1/search": () => staffHits, "GET /v1/admin/models": () => [] });
    const { router } = renderApp("/");
    const { user, dialog, input } = await openPalette();
    await user.type(input, "registrar chat");
    await user.click(await within(dialog).findByRole("option", { name: /Registrar chat/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/models"));
    expect(router.state.location.search).toMatchObject({ record: "m1" });
  });

  it("opens an MCP server as a record on its admin list", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/agents": () => [], "GET /v1/search": () => staffHits, "GET /v1/admin/mcp-servers": () => [] });
    const { router } = renderApp("/");
    const { user, dialog, input } = await openPalette();
    await user.type(input, "registrar status");
    await user.click(await within(dialog).findByRole("option", { name: /Registrar status/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/mcp-servers"));
    expect(router.state.location.search).toMatchObject({ record: "x1" });
  });

  it("says it is searching, cancels a search that is no longer wanted, and says when nothing was found", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/agents": () => [],
      "GET /v1/search": async (_b, call) => {
        if (call.search.get("q") === "zzq") await held;
        return [];
      },
    });
    renderApp("/");
    const { user, dialog, input } = await openPalette();
    await user.type(input, "zzq");
    const status = within(dialog).getByRole("status");
    expect(status).toHaveTextContent("Searching…");
    await waitFor(() => expect(searches(calls)).toHaveLength(1));

    await user.type(input, "x");
    await waitFor(() => expect(searches(calls)).toHaveLength(2));
    expect(searches(calls)[0]!.signal?.aborted).toBe(true);
    expect(searches(calls)[1]!.search.get("q")).toBe("zzqx");
    await waitFor(() => expect(status).toHaveTextContent("No results found."));
    release();
  });
});
