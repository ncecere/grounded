/* Publishing (docs/phase4-publishing.md §3, §5-§7, §10): directory groups, the public page, the embed page, the admin Public access page, the Share tab and the Audience section. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { type Schemas, setCsrfToken } from "../api/client";
import { embedSnippet, originProblem } from "../pages/agents/share/snippet";
import { publicRef } from "../pages/public/session";
import { type Handler, Reply, mockApi, renderApp, shellRoutes, sse } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.querySelectorAll('meta[name="grounded-embed-error"]').forEach((m) => m.remove());
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const card = (id: string, name: string, group: Schemas["AgentCard"]["group"], audience: Schemas["Audience"]): Schemas["AgentCard"] => ({
  id,
  teamSlug: group === "team" ? "registrar" : "library",
  teamName: group === "team" ? "Office of the Registrar" : "Libraries",
  slug: name.toLowerCase().replace(/ /g, "-"),
  name,
  description: "",
  accentColor: "",
  welcomeMessage: "",
  starterQuestions: [],
  citationMode: "snippet_link",
  status: "active",
  audience,
  group,
  shortName: null,
});

const publicAgent: Schemas["PublicAgent"] = {
  id: "0b5e2d3c-1a4f-4c6e-8f7a-9d0e1c2b3a4f",
  name: "Registrar help",
  teamName: "Office of the Registrar",
  description: "Registration and records.",
  accentColor: "#0021a5",
  welcomeMessage: "Hi! Ask me about registration.",
  starterQuestions: ["How do I order a transcript?"],
  citationMode: "snippet_link",
  status: "active",
  shortName: "registrar-help",
  captcha: { provider: "none", siteKey: "" },
  maxMessageChars: 2000,
};

const citation = { n: 1, documentId: "d1", sourceId: "s1", title: "Transcripts", snippet: "Order transcripts online.", headingPath: [], url: "https://registrar.example.edu/transcripts" };

const answer = (): [string, unknown][] => [
  ["conversation", { conversationId: "c1", userMessageId: "um1", agentVersion: 1 }],
  ["message_start", { messageId: "m1", buffered: true }],
  ["text_delta", { delta: "Order it online [1]." }],
  ["message_end", { messageId: "m1", stopReason: "stop", text: "Order it online [1].", citations: [citation], usage: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 2 }, refused: false, noContext: false }],
  ["done", {}],
];

describe("pure helpers", () => {
  it("builds the embed snippet and checks origins", () => {
    expect(embedSnippet({ scriptUrl: "https://rag.example.edu/widget.js", agentId: "a1", key: "pk_x", integrity: "sha384-abc" })).toBe(
      '<script src="https://rag.example.edu/widget.js" data-agent="a1" data-key="pk_x" integrity="sha384-abc" crossorigin="anonymous" async></script>',
    );
    expect(embedSnippet({ scriptUrl: "/widget.js", agentId: "a1", key: 'pk_"x', position: "bottom-left" })).toContain('data-key="pk_&quot;x" data-position="bottom-left" async');
    expect(originProblem("https://www.example.edu")).toBeUndefined();
    expect(originProblem("*.example.edu")).toBeUndefined();
    expect(originProblem("http://127.0.0.1:8095")).toBeUndefined();
    expect(originProblem("https://example.edu/page")).toMatch(/no path/);
    expect(originProblem("https://a.*.edu")).toMatch(/wildcard/);
    expect(publicRef("/a/registrar-help")).toBe("registrar-help");
    expect(publicRef("/a/id/0b5e2d3c-1a4f-4c6e-8f7a-9d0e1c2b3a4f")).toBe("0b5e2d3c-1a4f-4c6e-8f7a-9d0e1c2b3a4f");
    expect(publicRef("/a/registrar/helper")).toBe("registrar/helper");
    expect(publicRef("/agents")).toBeNull();
  });
});

describe("directory", () => {
  it("groups agents by audience with counts and badges, and filters by search, group and team in the URL", async () => {
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/agents": (_b, c) =>
        c.search.get("q") === "zzz"
          ? []
          : [
              card("a1", "Registrar assistant", "team", "team"),
              card("a2", "Library helper", "organisation", "all_authenticated"),
              card("a3", "Campus map", "public", "public"),
              card("a4", "Parking help", "team", "public"),
            ],
    });
    const { container, router } = renderApp("/agents");
    const org = await screen.findByRole("region", { name: /Shared with signed-in users/ });
    expect(within(org).getByRole("link", { name: /Library helper/ })).toHaveAttribute("href", "/a/library/library-helper");
    expect(within(org).getByText("Signed-in users")).toBeInTheDocument();
    const mine = screen.getByRole("region", { name: /From your teams/ });
    expect(mine).toHaveTextContent("Registrar assistant");
    expect(within(mine).getByRole("heading")).toHaveTextContent("From your teams · 2 agents");
    expect(screen.getByRole("region", { name: /Public/ })).toHaveTextContent("Campus map");
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Public" }));
    // Public matches the audience: the team's own public agent is listed too, not its team-only one.
    await waitFor(() => expect(screen.queryByText("Registrar assistant")).toBeNull());
    expect(screen.getByRole("region", { name: /From your teams/ })).toHaveTextContent("Parking help");
    expect(screen.getByRole("region", { name: /^Public/ })).toHaveTextContent("Campus map");
    expect(router.state.location.search).toMatchObject({ show: "public" });
    await userEvent.click(screen.getByRole("button", { name: "All" }));

    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "zzz");
    expect(await screen.findByText("No agents match.")).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/v1/agents" && c.search.get("q") === "zzz")).toBe(true);
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Team" }));
    await userEvent.click(await screen.findByRole("option", { name: /Libraries/ }));
    await waitFor(() => expect(calls.some((c) => c.search.get("team") === "library")).toBe(true));
  });
});

const signedOut: Record<string, Handler> = {
  "GET /v1/me": () => Reply.error(401, "unauthorized"),
  "GET /v1/auth/config": () => ({ oidcEnabled: false, devAuthEnabled: true, loginUrl: "/auth/login", teamRequestUrl: null, devAccounts: [], instance: { name: "Campus RAG", orgName: "", theme: "neutral", logoUrl: null, supportUrl: null } }),
};

describe("public page", () => {
  it("chats anonymously without the app shell: the session starts with the first question", async () => {
    const calls = mockApi({
      ...signedOut,
      "GET /v1/public/agents/registrar-help": () => publicAgent,
      "GET /v1/public/sessions/current": () => Reply.error(401, "session_required"),
      "POST /v1/public/sessions": () => new Reply(201, { data: { agentId: publicAgent.id, channel: "public", expiresAt: "2026-09-27T10:00:00Z" } }),
      [`POST /v1/public/agents/${publicAgent.id}/chat`]: () => sse(answer()),
    });
    const { container } = renderApp("/a/registrar-help");
    expect(await screen.findByRole("heading", { level: 1, name: "Registrar help" })).toBeInTheDocument();
    expect(screen.getByText("Campus RAG")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /main|primary/i })).toBeNull();
    // One header bar (W12): the instance, the agent and Sign in together; New chat once there's a conversation.
    const bar = screen.getByRole("heading", { level: 1, name: "Registrar help" }).closest("header")!;
    expect(within(bar).getByText("Campus RAG")).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(container.querySelectorAll("header")).toHaveLength(1);
    expect(within(bar).queryByRole("button", { name: "New chat" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.type(screen.getByRole("textbox", { name: "Message Registrar help" }), "How do I order a transcript?{Enter}");
    expect(await screen.findByText(/Order it online/)).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "New chat" })).toBeInTheDocument();
    const order = calls.filter((c) => c.method === "POST").map((c) => c.url);
    expect(order).toEqual(["/v1/public/sessions", `/v1/public/agents/${publicAgent.id}/chat`]);
    expect(calls.find((c) => c.url === "/v1/public/sessions")!.body).toEqual({ agentId: publicAgent.id });
    expect(screen.getByText("0 / 2,000")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("serves a public agent's team address to signed-out visitors, and the sign-in page otherwise (F-07)", async () => {
    mockApi({
      ...signedOut,
      "GET /v1/public/teams/registrar/agents/registrar-help": () => publicAgent,
      "GET /v1/public/sessions/current": () => Reply.error(401, "session_required"),
      "GET /v1/public/teams/registrar/agents/private-helper": () => Reply.error(404, "agent_not_found"),
    });
    const first = renderApp("/a/registrar/registrar-help");
    expect(await screen.findByRole("heading", { level: 1, name: "Registrar help" })).toBeInTheDocument();
    expect(await axe(first.container)).toHaveNoViolations();
    first.unmount();
    renderApp("/a/registrar/private-helper");
    expect(await screen.findByRole("heading", { level: 2, name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("This assistant isn't available publicly")).toBeNull();
  });

  it("explains an agent that isn't public", async () => {
    mockApi({ ...signedOut, "GET /v1/public/agents/nope": () => Reply.error(404, "agent_not_found") });
    const { container } = renderApp("/a/nope");
    expect(await screen.findByRole("heading", { level: 1, name: "This assistant isn't available publicly" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("embed page", () => {
  it("starts a widget session with the key and restores nothing without one", async () => {
    const calls = mockApi({
      [`GET /v1/public/agents/${publicAgent.id}`]: () => publicAgent,
      "GET /v1/auth/config": signedOut["GET /v1/auth/config"]!,
      "GET /v1/public/sessions/current": () => Reply.error(401, "session_required"),
      "POST /v1/public/sessions": () => new Reply(201, { data: { agentId: publicAgent.id, channel: "widget", expiresAt: "2026-09-27T10:00:00Z" } }),
      [`POST /v1/public/agents/${publicAgent.id}/chat`]: () => sse(answer()),
    });
    const { container } = renderApp(`/embed/${publicAgent.id}?key=pk_abc`);
    expect(await screen.findByRole("heading", { level: 1, name: "Registrar help" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "How do I order a transcript?" }));
    expect(await screen.findByText(/Order it online/)).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/v1/public/sessions")!.body).toMatchObject({ agentId: publicAgent.id, key: "pk_abc" });
  });

  it("shows the server's error for a refused embed", async () => {
    const meta = document.createElement("meta");
    meta.name = "grounded-embed-error";
    meta.content = "public_disabled";
    document.head.appendChild(meta);
    mockApi({ "GET /v1/auth/config": signedOut["GET /v1/auth/config"]! });
    const { container } = renderApp(`/embed/${publicAgent.id}?key=pk_abc`);
    expect(await screen.findByText("Public chat is turned off")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("admin public access", () => {
  const settings = { publicAgentsEnabled: false, revision: 1, updatedAt: "2026-09-26T10:00:00Z", captcha: { provider: "turnstile", siteKey: "0x4AAA" }, anonSessionTtlSeconds: 86400 };
  const limit = (key: string, label: string, def: number, period: "none" | "minute" | "day") => ({
    key, group: "public", unit: "count", period, label, description: "…", default: def, ceiling: null, builtInDefault: def, custom: false,
  });
  it("turns public agents on with If-Match and shows CAPTCHA, and links to the public limits instead of repeating them (Q9)", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/settings/public-access": () => settings,
      "PUT /v1/admin/settings/public-access": (b) => ({ ...settings, ...(b as object), revision: 2 }),
      "GET /v1/admin/limits": () => ({ items: [limit("public_queries_per_ip_per_minute", "Public questions per minute (each address)", 10, "minute")], revision: 1, updatedAt: "" }),
    });
    const { container } = renderApp("/admin/public-access");
    const sw = await screen.findByRole("switch", { name: "Allow public agents" });
    expect(screen.getByText("Cloudflare Turnstile")).toBeInTheDocument();
    expect(screen.queryByText("10 per minute")).toBeNull();
    expect(await screen.findByText("Built-in defaults")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Change public limits/ })).toHaveAttribute("href", "/admin/limits?tab=public");
    expect(screen.getByText("Public agents are off")).toBeInTheDocument();
    expect(screen.getByText("24 hours after the last question")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(sw);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"1"');
    expect(put.body).toEqual({ publicAgentsEnabled: true });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Allow public agents" })).toBeChecked());
  });
});

// ---- agent editor ----------------------------------------------------------------------

const config: Schemas["AgentConfig"] = {
  instructions: "Help students.", chatModelId: "mod1", kbs: [{ kbId: "kb1", topK: 6 }], retrievalMode: "always", maxTurns: 4, contextTokenBudget: 6000,
  minSimilarity: 0, strictlyGrounded: true, refusalMessage: "No.", citationMode: "snippet_link", queryRewrite: true, moderation: { categories: {}, outputMode: "" }, audience: "public",
};
const agent: Schemas["Agent"] = {
  id: "ag1", teamId: "t1", teamSlug: "registrar", slug: "registrar-help", name: "Registrar help", description: "", accentColor: "", welcomeMessage: "", starterQuestions: [],
  status: "active", disabledReason: "", disabledAt: null, audience: "public", draft: config, draftRevision: 1, published: null, hasUnpublishedChanges: true, warnings: [],
  revision: 2, createdAt: "2026-09-26T09:00:00Z", updatedAt: "2026-09-26T10:00:00Z",
};
const sharing: Schemas["AgentSharing"] = {
  agentId: "ag1", audience: "public", draftAudience: "public", shortName: "registrar-help", publicAgentsEnabled: true, classification: "open", maxAudience: "public",
  options: [
    { audience: "team", allowed: true, reasons: [] },
    { audience: "all_authenticated", allowed: true, reasons: [] },
    { audience: "public", allowed: false, reasons: ["A platform admin must set a public moderation policy with a working provider"] },
  ],
  links: { team: "https://rag.example.edu/a/registrar/registrar-help", id: "https://rag.example.edu/a/id/ag1", short: "https://rag.example.edu/a/registrar-help" },
  widget: { scriptUrl: "https://rag.example.edu/widget.js", integrity: "sha384-abc", maxMessageChars: 2000 },
};
const key: Schemas["PublishableKey"] = {
  id: "k1", agentId: "ag1", name: "Main site", keyPreview: "pk_AbCdEfGhIjKl_…", allowedOrigins: ["https://www.example.edu"], rateLimits: {}, enabled: true, revision: 1,
  lastUsedAt: null, createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z",
};
const editorRoutes = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes(),
  "GET /v1/teams/registrar/agents/ag1": () => agent,
  "GET /v1/teams/registrar/agents/ag1/versions": () => [],
  "GET /v1/teams/registrar/agents/ag1/sharing": () => sharing,
  "GET /v1/teams/registrar/agents/ag1/publishable-keys": () => [key],
  "GET /v1/chat-models": () => [],
  "GET /v1/teams/registrar/kbs": () => [],
  ...extra,
});

describe("widget preview", () => {
  it("uses the real public message limit (P-14)", async () => {
    mockApi(editorRoutes());
    renderApp("/embed/ag1?preview=1&team=registrar");
    expect(await screen.findByText("0 / 2,000")).toBeInTheDocument();
  });

  it("loads the session outside the app's gate, so the test request carries the CSRF token (M1)", async () => {
    setCsrfToken(""); // a fresh frame: nothing has fetched /v1/me yet
    const calls = mockApi(editorRoutes({ "POST /v1/teams/registrar/agents/ag1/test": () => sse(answer()) }));
    const { container } = renderApp("/embed/ag1?preview=1&team=registrar");
    const box = await screen.findByRole("textbox", { name: "Message Registrar help" });
    await userEvent.type(box, "How do I order a transcript?{Enter}");
    expect(await screen.findByText(/Order it online/)).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/test"))!;
    expect(post.headers.get("X-CSRF-Token")).toBe("csrf-123");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("asks a signed-out visitor to sign in instead of failing on send", async () => {
    mockApi({ ...editorRoutes(), "GET /v1/me": () => null });
    renderApp("/embed/ag1?preview=1&team=registrar");
    expect(await screen.findByText("Sign in to preview this agent")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("agent editor sharing", () => {
  it("Share starts with the audience options, each with why it isn't available", async () => {
    mockApi(editorRoutes());
    const { container } = renderApp("/teams/registrar/agents/ag1?tab=share");
    const group = await screen.findByRole("radiogroup", { name: "Who can chat" }, { timeout: 5000 });
    // The selected option says why it can't be published, rather than "Not available".
    await waitFor(() => expect(within(group).getByText(/You can't publish to it: A platform admin must set a public moderation policy/)).toBeInTheDocument());
    expect(within(group).getByRole("radio", { name: /Public/ })).toBeChecked();
    expect(within(group).getByRole("radio", { name: /Signed-in users/ })).not.toHaveAttribute("data-disabled");
    // Audience, then Links, then the Widget (the draft is Public).
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(-3)).toEqual(["Audience", "Links", "Widget"]);
    expect(await axe(container, { iframes: false })).toHaveNoViolations();
  });

  it("an editor who narrows a shared agent's draft can go back to the live audience", async () => {
    const editorOnly = "Only team admins and owners can publish beyond the team";
    const live = { ...agent, audience: "all_authenticated" as const, draft: { ...config, audience: "team" as const }, hasUnpublishedChanges: true,
      published: { version: 4, publishedAt: "2026-09-26T10:00:00Z", publishedBy: null, note: "" } } as unknown as Schemas["Agent"];
    mockApi({
      ...editorRoutes({
        "GET /v1/teams/registrar/agents/ag1": () => live,
        "GET /v1/teams/registrar/agents/ag1/sharing": () => ({
          ...sharing, audience: "all_authenticated", draftAudience: "team",
          options: [
            { audience: "team", allowed: true, reasons: [] },
            { audience: "all_authenticated", allowed: false, reasons: [editorOnly] },
            { audience: "public", allowed: false, reasons: [editorOnly] },
          ],
        }),
      }),
      ...shellRoutes("none", "editor"),
    });
    renderApp("/teams/registrar/agents/ag1?tab=share");
    const group = await screen.findByRole("radiogroup", { name: "Who can chat" }, { timeout: 5000 });
    const signedIn = within(group).getByRole("radio", { name: /Signed-in users/ });
    await waitFor(() => expect(signedIn).not.toHaveAttribute("data-disabled"));
    expect(within(group).getByText(/The live version uses it\. You can't publish to it/)).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: /Public/ })).toHaveAttribute("data-disabled");
  });

  it("Share tab: links, keys, creating a key puts it in the snippet, and a preview", async () => {
    const calls = mockApi(
      editorRoutes({
        "POST /v1/teams/registrar/agents/ag1/publishable-keys": (b) => new Reply(201, { data: { ...key, id: "k2", ...(b as object), key: "pk_NewNewNewNew_secretsecretsecretsecretsecrets" } }),
        "POST /v1/widget-origins/check": (b) =>
          (b as { origins: string[] }).origins.map((o) =>
            o.includes("/page") ? { input: o, origin: null, problem: "an origin has no path: remove everything after the host and port" } : { input: o, origin: o.includes("://") ? o : `http://${o}`, problem: null },
          ),
      }),
    );
    const { container, router } = renderApp("/teams/registrar/agents/ag1?tab=share");
    expect(await screen.findByRole("tab", { name: "Share", selected: true })).toBeInTheDocument();
    expect(await screen.findByText("https://rag.example.edu/a/registrar-help", {}, { timeout: 5000 })).toBeInTheDocument();
    // F-07: the short address comes first; the page says which work signed out.
    expect(screen.getByText("Not published yet: the links work once a version is published.")).toBeInTheDocument();
    const [short, id, team] = ["https://rag.example.edu/a/registrar-help", "https://rag.example.edu/a/id/ag1", "https://rag.example.edu/a/registrar/registrar-help"].map((t) => screen.getByText(t));
    expect(short!.compareDocumentPosition(id!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(id!.compareDocumentPosition(team!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Widget keys" });
    expect(within(table).getByText("pk_AbCdEfGhIjKl_…")).toBeInTheDocument();
    expect(screen.getByTitle("Widget preview of Registrar help")).toHaveAttribute("src", "/embed/ag1?preview=1&team=registrar");
    // The preview frame's page has its own axe test (embed page, above).
    expect(await axe(container, { iframes: false })).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "New widget key" }));
    const dialog = await screen.findByRole("region", { name: "New widget key" });
    // A form page like every other: ?form=new (G18).
    expect(router.state.location.searchStr).toMatch(/[?&]form=new\b/);
    expect(router.state.location.searchStr).not.toMatch(/record=/);
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Demo page");
    const origins = within(dialog).getByRole("textbox", { name: /Allowed origins/ });
    // F-08: the sheet asks for a scheme, shows how an origin is saved, and names problems.
    await userEvent.type(origins, "localhost:8095{Enter}");
    expect(await within(dialog).findByText(/Add the scheme to be sure: localhost:8095 will be saved as http:\/\/localhost:8095/)).toBeInTheDocument();
    await userEvent.type(origins, "https://example.edu/page{Enter}");
    expect(await within(dialog).findByText(/https:\/\/example.edu\/page: an origin has no path/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /Remove tag https:\/\/example.edu\/page/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: /Remove tag localhost:8095/ }));
    await userEvent.type(origins, "http://127.0.0.1:8095{Enter}");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/publishable-keys"))!.body).toMatchObject({ name: "Demo page", allowedOrigins: ["http://127.0.0.1:8095"] });
    expect(await screen.findAllByText(/data-key="pk_NewNewNewNew_secretsecretsecretsecretsecrets"/)).not.toHaveLength(0);
    expect(screen.getAllByText(/integrity="sha384-abc"/).length).toBeGreaterThan(0);
  });
});
