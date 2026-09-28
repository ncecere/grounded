/* Agents (list, create, editor tabs, autosave, publish) and the Phase 3 changes to existing screens. Admin agents: admin-agents.test.tsx. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { uploadFiles } from "../pages/team/documents/upload";
import { type Handler, Reply, mockApi, renderApp, shellRoutes, sse } from "./harness";
import { boilerplate } from "./web-harness";

const config: Schemas["AgentConfig"] = {
  instructions: "Help students.",
  chatModelId: "mod1",
  kbs: [{ kbId: "kb1", topK: 6 }],
  retrievalMode: "always",
  maxTurns: 4,
  contextTokenBudget: 6000,
  minSimilarity: 0,
  strictlyGrounded: true,
  refusalMessage: "I couldn't find that.",
  citationMode: "snippet_link",
  queryRewrite: true,
  moderation: { categories: {}, outputMode: "" },
  audience: "team",
};

const version: Schemas["AgentVersion"] = {
  id: "v1",
  version: 1,
  publishedAt: "2026-09-26T10:00:00Z",
  publishedBy: "u1",
  publishedByName: "Una User",
  note: "First version",
  chatModelId: "mod1",
  chatModelName: "GPT-OSS 120B (Campus gateway)",
  effectiveRank: 0,
  classification: "open",
  knowledgeBases: [{ id: "kb1", name: "Registrar help", topK: 6 }],
  config,
};

const agent = (extra: Partial<Schemas["Agent"]> = {}): Schemas["Agent"] => ({
  id: "ag1",
  teamId: "t1",
  teamSlug: "registrar",
  slug: "registrar-assistant",
  name: "Registrar assistant",
  description: "Registration and records.",
  accentColor: "",
  welcomeMessage: "Hi!",
  starterQuestions: ["How do I drop a class?"],
  status: "active",
  disabledReason: "",
  disabledAt: null,
  audience: "team",
  draft: config,
  draftRevision: 1,
  published: version,
  hasUnpublishedChanges: false,
  warnings: [],
  revision: 2,
  createdAt: "2026-09-26T09:00:00Z",
  updatedAt: "2026-09-26T10:00:00Z",
  ...extra,
});

const models = [
  { id: "mod1", key: "gpt-oss-120b", displayName: "GPT-OSS 120B (Campus gateway)", description: "", maxClassification: "sensitive", contextWindow: 131072, maxOutputTokens: 8192, supportsTools: true, supportsReasoningEffort: false },
  { id: "mod2", key: "small", displayName: "Small model", description: "", maxClassification: "open", contextWindow: 8192, maxOutputTokens: 1024, supportsTools: false, supportsReasoningEffort: false },
];

const kb = (id: string, name: string) => ({
  id,
  name,
  description: "",
  embeddingProfileId: "p1",
  topK: 8,
  effectiveClassification: "open",
  sources: [{ id: "s1", name: "Registrar website", classification: "open", shared: false }],
  revision: 1,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
});

const agentRoutes = (extra: Record<string, Handler> = {}, current = agent()): Record<string, Handler> => ({
  ...shellRoutes(),
  "GET /v1/teams/registrar/agents": () => [current],
  "GET /v1/teams/registrar/agents/ag1": () => current,
  "GET /v1/teams/registrar/agents/ag1/versions": () => [version],
  "GET /v1/teams/registrar/agents/ag1/versions/1": () => version,
  "GET /v1/chat-models": () => models,
  "GET /v1/teams/registrar/kbs": () => [kb("kb1", "Registrar help"), kb("kb2", "Policies")],
  ...extra,
});

const analytics = {
  from: "2026-09-01",
  to: "2026-09-26",
  totals: { conversations: 12, answers: 30, uniqueUsers: 5, up: 8, down: 2, satisfaction: 0.8, noContextRate: 0.1, refusalRate: 0.05, errorRate: 0, latencyP50Ms: 2400, latencyP95Ms: 6100, firstTokenP50Ms: 900,
    moderation: { questionsBlocked: 3, answersWithheld: 1, flagged: 2 } },
  daily: [
    { date: "2026-09-25", conversations: 2, answers: 5 },
    { date: "2026-09-26", conversations: 3, answers: 9 },
  ],
  models: [{ modelId: "mod1", modelName: "GPT-OSS 120B (Campus gateway)", answers: 30, inputTokens: 40000, outputTokens: 9000, reasoningTokens: 2000 }],
  topDocuments: [{ documentId: "d1", title: "Drop/Add", citations: 11 }],
  feedbackReasons: [{ reason: "outdated", count: 2 }],
  channels: [{ channel: "ui", answers: 20 }, { channel: "widget", answers: 8 }, { channel: "test", answers: 2 }],
  audiences: [{ audience: "public", answers: 18 }, { audience: "team", answers: 12 }],
  moderation: [
    { stage: "input", decision: "block", category: "violence", count: 3 },
    { stage: "output", decision: "block", category: "violence", count: 1 },
    { stage: "input", decision: "flag", category: "personal_data", count: 2 },
    { stage: "input", decision: "error", category: "", count: 1 },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

describe("team agents list", () => {
  it("lists agents with status, audience, unpublished changes and the model's name, filtered in the URL (W6)", async () => {
    const draftOnly = agent({ id: "ag2", name: "Draft helper", slug: "draft-helper", published: null, hasUnpublishedChanges: true, draft: { ...config, chatModelId: "mod2", audience: "public" } });
    mockApi(agentRoutes({ "GET /v1/teams/registrar/agents": () => [agent({ hasUnpublishedChanges: true, audience: "all_authenticated" }), draftOnly] }));
    const { container, router } = renderApp("/teams/registrar/agents");
    const table = await screen.findByRole("table", { name: "Agents" }, { timeout: 5000 });
    const live = await within(table).findByRole("row", { name: /Registrar assistant/ });
    const draft = within(table).getByRole("row", { name: /Draft helper/ });
    expect(within(live).getByRole("link", { name: "Registrar assistant" })).toBeInTheDocument();
    expect(live).toHaveTextContent(/Live\s*Unpublished changes/);
    expect(live).toHaveTextContent("Signed-in users");
    expect(live).toHaveTextContent("GPT-OSS 120B (Campus gateway)");
    expect(live).toHaveTextContent(/v1 ·/);
    expect(draft).toHaveTextContent("Public (draft)");
    expect(draft).toHaveTextContent("Small model");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: /^Not published, / }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ status: "draft" }));
    expect(within(table).queryByText("Registrar assistant")).toBeNull();
    expect(within(table).getByText("Draft helper")).toBeInTheDocument();
  });

  it("creates an agent with a slug from its name, a model and knowledge bases", async () => {
    const calls = mockApi(agentRoutes({ "POST /v1/teams/registrar/agents": () => agent({ id: "ag1" }) }));
    const { router } = renderApp("/teams/registrar/agents");
    await userEvent.click(await screen.findByRole("button", { name: "New agent" }));
    const dialog = await screen.findByRole("dialog", { name: "New agent" });
    // Knowledge bases come right after the name; the model shows its display name (W9, Q11).
    const kbBox = within(dialog).getByRole("checkbox", { name: /Policies/ });
    expect(kbBox.compareDocumentPosition(within(dialog).getByRole("combobox", { name: /Chat model/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Student Help Désk");
    expect(within(dialog).getByRole("textbox", { name: /Address/ })).toHaveValue("student-help-desk");
    expect(within(dialog).getByRole("combobox", { name: /Chat model/ })).toHaveTextContent("GPT-OSS 120B (Campus gateway)");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Policies/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create agent" }));
    // It lands on Build with the Test chat open.
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/agents/ag1"));
    expect(router.state.location.search).toEqual({ test: "open" });
    const body = calls.find((c) => c.method === "POST" && c.url === "/v1/teams/registrar/agents")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ name: "Student Help Désk", slug: "student-help-desk", config: { chatModelId: "mod1", kbs: [{ kbId: "kb2", topK: 6 }] } });
  });
});

describe("agent editor", () => {
  it("autosaves the draft with the revision after a pause", async () => {
    const calls = mockApi(
      agentRoutes({
        "PATCH /v1/teams/registrar/agents/ag1": (b) => agent({ revision: 3, draft: { ...config, ...(b as { config: Schemas["AgentConfig"] }).config }, hasUnpublishedChanges: true }),
      }),
    );
    const { container } = renderApp("/teams/registrar/agents/ag1");
    const instructions = await screen.findByRole("textbox", { name: "Instructions" }, { timeout: 5000 });
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.type(instructions, " Be brief.");
    expect(screen.getByText(/Unsaved changes|Saving…/)).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true), { timeout: 3000 });
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.headers.get("If-Match")).toBe('"2"');
    expect((patches[0]!.body as { config: Schemas["AgentConfig"] }).config.instructions).toBe("Help students. Be brief.");
    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
    expect(screen.getByText("Unpublished changes")).toBeInTheDocument();
  });

  it("on a save conflict (412) keeps the user's text and offers Keep mine / Use theirs", async () => {
    let reloaded = false;
    const calls: { method: string; body: unknown; ifMatch: string | null }[] = [];
    const theirs = () => agent({ revision: 7, name: "Renamed elsewhere", draft: { ...config, instructions: "Changed elsewhere." } });
    mockApi(
      agentRoutes({
        "GET /v1/teams/registrar/agents/ag1": () => (reloaded ? theirs() : agent()),
        "PATCH /v1/teams/registrar/agents/ag1": (body, call) => {
          calls.push({ method: call.method, body, ifMatch: call.headers.get("If-Match") });
          if (!reloaded) {
            reloaded = true;
            return Reply.error(412, "stale", "The resource changed.");
          }
          return { ...theirs(), revision: 8, draft: (body as { config: Schemas["AgentConfig"] }).config };
        },
      }),
    );
    const { container } = renderApp("/teams/registrar/agents/ag1");
    await userEvent.type(await screen.findByRole("textbox", { name: "Instructions" }), "!");
    expect(await screen.findByText("This agent was changed somewhere else", {}, { timeout: 3000 })).toBeInTheDocument();
    // The user's text stays in the form; the latest is shown beside it.
    expect(screen.getByRole("textbox", { name: "Instructions" })).toHaveValue("Help students.!");
    const diff = screen.getByRole("table", { name: /Instructions: the latest version and yours/ });
    expect(diff).toHaveTextContent("Changed elsewhere.");
    expect(diff).toHaveTextContent("Help students.!");
    expect(screen.getByText(/Both of you changed: Instructions/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    // Re-applied on top of the latest revision: their rename survives, the instructions are mine.
    expect(calls[1]!.ifMatch).toBe('"7"');
    const body = calls[1]!.body as { config: Schemas["AgentConfig"]; name?: string };
    expect(body.config.instructions).toBe("Help students.!");
    expect(body.name).toBeUndefined();
    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
    expect(screen.queryByText("This agent was changed somewhere else")).not.toBeInTheDocument();
  });

  it("Use theirs drops the user's edits after a save conflict", async () => {
    let reloaded = false;
    mockApi(
      agentRoutes({
        "GET /v1/teams/registrar/agents/ag1": () => (reloaded ? agent({ revision: 7, draft: { ...config, instructions: "Changed elsewhere." } }) : agent()),
        "PATCH /v1/teams/registrar/agents/ag1": () => {
          reloaded = true;
          return Reply.error(412, "stale", "The resource changed.");
        },
      }),
    );
    renderApp("/teams/registrar/agents/ag1");
    await userEvent.type(await screen.findByRole("textbox", { name: "Instructions" }), "!");
    await userEvent.click(await screen.findByRole("button", { name: "Use theirs" }, { timeout: 3000 }));
    expect(screen.getByRole("textbox", { name: "Instructions" })).toHaveValue("Changed elsewhere.");
    expect(screen.getByText("Draft saved")).toBeInTheDocument();
  });

  it("shows draft warnings with links that focus the field, and disables tool mode for models without tools", async () => {
    mockApi(agentRoutes({}, agent({ warnings: [{ field: "draft.chatModelId", problem: "Choose a chat model" }], draft: { ...config, chatModelId: "mod2" } })));
    renderApp("/teams/registrar/agents/ag1");
    const warning = await screen.findByText("Fix these before publishing");
    await userEvent.click(within(warning.closest("[role]")!).getByRole("button", { name: "Chat model" }));
    // The link opens the Model section and focuses the picker.
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^Chat model/ })).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: /^Answering/ }));
    expect(screen.getByRole("radio", { name: /Let the model decide/ })).toHaveAttribute("data-disabled");
    expect(screen.getByText(/Small model can't call tools/)).toBeInTheDocument();
  });

  it("SystemOne checks: a Build section only with a SystemOne model, saved as the agent's override", async () => {
    const calls = mockApi(
      agentRoutes({
        "GET /v1/systemone/status": () => ({ available: true, judging: { enabled: false, candidates: 20 }, citations: { enabled: true, mode: "annotate" }, scope: { enabled: false } }),
        "PATCH /v1/teams/registrar/agents/ag1": (b) => agent({ revision: 3, draft: { ...config, ...(b as { config: Schemas["AgentConfig"] }).config }, hasUnpublishedChanges: true }),
      }),
    );
    const { container } = renderApp("/teams/registrar/agents/ag1");
    await userEvent.click(await screen.findByRole("button", { name: /^SystemOne checks/ }, { timeout: 5000 }));
    const checks = await screen.findByRole("group", { name: "SystemOne checks" });
    const judging = within(checks).getByRole("combobox", { name: "Passage judging" });
    expect(judging).toHaveValue("");
    expect(within(judging).getByRole("option", { name: "Platform default (off)" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    expect(within(checks).getByRole("combobox", { name: "Citation checks" })).toHaveValue("");
    expect(within(checks).getByRole("option", { name: "Platform default (on)" })).toBeInTheDocument();
    expect(within(checks).getByRole("option", { name: "Platform default (annotate)" })).toBeInTheDocument();
    await userEvent.selectOptions(judging, "on");
    await userEvent.selectOptions(within(checks).getByRole("combobox", { name: "Citation mode" }), "enforce");
    await userEvent.selectOptions(within(checks).getByRole("combobox", { name: "Scope check" }), "on");
    const lastPatch = () => calls.filter((c) => c.method === "PATCH").at(-1)?.body as { config: Schemas["AgentConfigInput"] } | undefined;
    await waitFor(() => expect(lastPatch()?.config.systemOne).toEqual({ judging: "on", citationMode: "enforce", scope: "on" }), { timeout: 4000 });
  });

  it("hides SystemOne checks without a SystemOne model and sends no override", async () => {
    const calls = mockApi(
      agentRoutes({
        "GET /v1/systemone/status": () => ({ available: false, judging: { enabled: false, candidates: 20 }, citations: { enabled: false, mode: "annotate" }, scope: { enabled: false } }),
        "PATCH /v1/teams/registrar/agents/ag1": () => agent({ revision: 3 }),
      }),
    );
    renderApp("/teams/registrar/agents/ag1");
    await screen.findByRole("button", { name: /^Advanced/ }, { timeout: 5000 });
    expect(screen.queryByRole("button", { name: /^SystemOne checks/ })).toBeNull();
    await userEvent.type(screen.getByRole("textbox", { name: "Instructions" }), "!");
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true), { timeout: 3000 });
    expect("systemOne" in (calls.find((c) => c.method === "PATCH")!.body as { config: object }).config).toBe(false);
  });

  it("lists publish problems (422) with links to the fields", async () => {
    mockApi(
      agentRoutes({
        "GET /v1/teams/registrar/agents/ag1": () => agent({ hasUnpublishedChanges: true }),
        "POST /v1/teams/registrar/agents/ag1/publish": () =>
          Reply.error(422, "agent_invalid", "The agent can't be published yet", { problems: [{ field: "kbs", problem: "Choose at least one knowledge base" }] }),
      }),
    );
    renderApp("/teams/registrar/agents/ag1");
    await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog", { name: /Publish version 2/ });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What changed/ }), "Shorter answers");
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    expect(await within(dialog).findByText(/Choose at least one knowledge base/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Knowledge bases" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Registrar help/ })).toHaveFocus());
  });

  it("the default accent follows the installed theme's primary colour (G17)", async () => {
    const { DEFAULT_ACCENT, themeAccent } = await import("../pages/agents/accents.colors");
    expect(themeAccent()).toBe(DEFAULT_ACCENT);
    document.documentElement.style.setProperty("--color-primary", "#1B5E20");
    expect(themeAccent()).toBe("#1b5e20");
    document.documentElement.style.removeProperty("--color-primary");
  });

  it("appearance: live contrast check holds back a failing colour; the tab has no axe violations", async () => {
    const calls = mockApi(agentRoutes({ "PATCH /v1/teams/registrar/agents/ag1": () => agent({ revision: 3 }) }));
    const { container } = renderApp("/teams/registrar/agents/ag1?tab=appearance");
    const hex = await screen.findByRole("textbox", { name: "Accent colour" });
    // The default is the theme's primary, as the preview draws it (G17).
    expect(screen.getByText(/Leave it empty for the theme's colour, #4b4fd6\./)).toBeInTheDocument();
    await userEvent.type(hex, "#fa4616");
    expect(await screen.findAllByText(/below 4.5:1/)).not.toHaveLength(0);
    await new Promise((r) => setTimeout(r, 1000));
    expect(screen.getByText("Not saved: fix the highlighted field")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "PATCH").every((c) => !("accentColor" in (c.body as object)))).toBe(true);
    expect(screen.getByRole("complementary", { name: "Preview" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  }, 10_000);

  it("warns beside the moderation rules when the audience has no provider (F-18)", async () => {
    const problem = "No moderation provider is set for the team audience, so these stricter rules have no effect and the agent can't be published with them. A platform admin can set one under Admin → Moderation.";
    mockApi(
      agentRoutes({
        "GET /v1/teams/registrar/agents/ag1": () =>
          agent({
            draft: { ...config, moderation: { categories: { violence: { input: { action: "block", threshold: 0.5 }, output: { action: "off", threshold: 0.5 } } }, outputMode: "" } },
            warnings: [{ field: "draft.moderation", problem }],
          }),
      }),
    );
    const { container } = renderApp("/teams/registrar/agents/ag1");
    const alert = (await screen.findByText("These rules have no effect yet")).closest("[role]")!;
    expect(alert).toHaveTextContent("No moderation provider is set for the team audience");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("reverting to the live version says there is nothing to publish (P-09)", async () => {
    mockApi(
      agentRoutes({
        "GET /v1/teams/registrar/agents/ag1": () => agent({ hasUnpublishedChanges: true, draft: { ...config, instructions: "Changed." } }),
        "POST /v1/teams/registrar/agents/ag1/revert": () => agent({ hasUnpublishedChanges: false, revision: 3 }),
      }),
    );
    renderApp("/teams/registrar/agents/ag1?tab=versions");
    const table = await screen.findByRole("table", { name: "Published versions" });
    await userEvent.click(within(table).getByRole("button", { name: "Actions for version 1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Revert draft…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Revert draft" }));
    expect(await screen.findByText(/This is the live version: there are no unpublished changes/)).toBeInTheDocument();
    expect(screen.queryByText("Test it, then publish to make it live.")).toBeNull();
  });

  it("versions and analytics tabs render with no axe violations", async () => {
    mockApi(agentRoutes({ "GET /v1/teams/registrar/agents/ag1/analytics": () => analytics }));
    const v = renderApp("/teams/registrar/agents/ag1?tab=versions");
    const table = await screen.findByRole("table", { name: "Published versions" });
    expect(within(table).getByText("First version")).toBeInTheDocument();
    await userEvent.click(within(table).getByRole("button", { name: "Actions for version 1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "View details" }));
    const page = await screen.findByRole("region", { name: "Version 1" });
    expect(page).toHaveTextContent("Help students.");
    expect(v.router.state.location.search).toMatchObject({ record: 1 });
    expect(await axe(v.container)).toHaveNoViolations();
    await userEvent.click(within(page).getByRole("link", { name: /^Back/ }));
    expect(await screen.findByRole("table", { name: "Published versions" })).toBeInTheDocument();
    v.unmount();

    const a = renderApp("/teams/registrar/agents/ag1?tab=analytics");
    // Five KPIs; satisfaction says how many ratings it rests on.
    const kpis = await screen.findByRole("region", { name: "Key figures" }, { timeout: 5000 });
    expect(kpis).toHaveTextContent(/Satisfaction\s*80%\s*From 10 ratings/);
    expect(within(kpis).getAllByRole("term")).toHaveLength(5);
    expect(screen.getByText("2.4 s")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Answers per day from Sep 25, 2026 to Sep 26, 2026: 14 answers and 5 conversations/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Answers per audience" })).toHaveTextContent(/Public\s*18\s*60%/);
    expect(screen.getByRole("table", { name: "Answers per channel" })).toHaveTextContent(/Embedded widget\s*8/);
    expect(await axe(a.container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Content" }));
    await waitFor(() => expect(a.router.state.location.search).toMatchObject({ tab: "analytics", view: "content" }));
    expect(screen.getByRole("table", { name: "Most cited documents" })).toHaveTextContent("Drop/Add");
    await userEvent.click(screen.getByRole("button", { name: "Moderation" }));
    const mod = screen.getByRole("table", { name: "Blocked and flagged by category" });
    expect(within(mod).getAllByRole("row")[1]).toHaveTextContent(/Violence\s*3\s*0\s*1\s*0/);
    expect(within(mod).getAllByRole("row")[2]).toHaveTextContent(/Personal data\s*0\s*2\s*0\s*0/);
    expect(screen.getByText(/provider failed on 1 question and 0 answers/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Moderation" })).toHaveTextContent(/Questions blocked\s*3/);
    expect(await axe(a.container)).toHaveNoViolations();
  });

  it("the moderation override only adds stricter rules and buffering", async () => {
    const calls = mockApi(
      agentRoutes({
        "PATCH /v1/teams/registrar/agents/ag1": (b) => agent({ revision: 3, draft: { ...config, ...(b as { config: Schemas["AgentConfig"] }).config } }),
      }),
    );
    const { container } = renderApp("/teams/registrar/agents/ag1");
    // Closed, the Safety section sums up the override.
    const safety = await screen.findByRole("button", { name: /^Safety/ }, { timeout: 5000 });
    expect(safety).toHaveTextContent("Platform policy only");
    await userEvent.click(safety);
    await userEvent.click(screen.getByRole("switch", { name: /Check answers before showing them/ }));
    await userEvent.click(screen.getByRole("button", { name: /Stricter category rules/ }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Self-harm, questions: action" }), "block");
    const threshold = screen.getByRole("textbox", { name: "Self-harm, questions: threshold (%)" });
    await userEvent.clear(threshold);
    await userEvent.type(threshold, "30");
    expect(screen.getByText("1 category tightened")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true), { timeout: 3000 });
    const last = calls.filter((c) => c.method === "PATCH").at(-1)!.body as { config: Schemas["AgentConfig"] };
    await waitFor(() => {
      const body = calls.filter((c) => c.method === "PATCH").at(-1)!.body as { config: Schemas["AgentConfig"] };
      expect(body.config.moderation).toEqual({
        outputMode: "buffer",
        categories: { self_harm: { input: { action: "block", threshold: 0.3 }, output: { action: "off", threshold: 0.5 } } },
      });
    }, { timeout: 3000 });
    expect(last.config.instructions).toBe("Help students.");
  });

  it("the draft test is labelled, streams, and lists agent_invalid problems", async () => {
    let invalid = true;
    const calls = mockApi(
      agentRoutes({
        "POST /v1/teams/registrar/agents/ag1/test": () =>
          invalid
            ? Reply.error(422, "agent_invalid", "Not valid", { problems: [{ field: "chatModelId", problem: "This chat model is disabled" }] })
            : sse([
                ["conversation", { conversationId: null, userMessageId: null, agentVersion: null }],
                ["message_start", { messageId: "t1" }],
                ["message_end", { messageId: "t1", stopReason: "stop", text: "Draft answer.", citations: [], usage: {}, refused: false, noContext: true }],
                ["done", {}],
              ]),
      }),
    );
    // The old Test tab opens Build, whose Test chat sits beside the sections.
    const { container, router } = renderApp("/teams/registrar/agents/ag1?tab=test");
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" }, { timeout: 5000 });
    expect(router.state.location.search).toEqual({ test: "open" });
    expect(screen.getByRole("tab", { name: "Build", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Test" })).toBeInTheDocument();
    await userEvent.type(box, "Hi{Enter}");
    expect(await screen.findByText("The draft can't be tested yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat model" })).toBeInTheDocument();
    invalid = false;
    await userEvent.type(box, "{Enter}");
    expect(await screen.findByText("Draft answer.")).toBeInTheDocument();
    expect(screen.getByText(/isn't based on the knowledge base/)).toBeInTheDocument();
    expect((calls.filter((c) => c.url.endsWith("/test")).at(-1)!.body as { history: unknown[] }).history).toEqual([]);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("existing screens", () => {
  const source = {
    id: "s1",
    name: "Registrar website",
    description: "",
    type: "upload",
    classification: "open",
    embeddingProfileId: "p1",
    status: "active",
    documents: { total: 1, pending: 0, processing: 0, ready: 1, failed: 0, skipped: 0, bytes: 10, chunks: 2 },
    revision: 3,
    createdAt: "",
    updatedAt: "",
    web: null,
    lastSyncAt: null,
    nextSyncAt: null,
    activeCrawl: null,
    boilerplate: boilerplate({ enabled: false }),
  };
  const doc = { id: "d1", sourceId: "s1", title: "Drop/Add", filename: "drop.pdf", url: "", kind: "pdf", sizeBytes: 10, version: 1, status: "ready", errorCode: "", errorMessage: "", pages: 1, chunkCount: 2, tokenCount: 10, warnings: [], tags: ["policy"], createdAt: "", updatedAt: "" };
  const impact = {
    classification: "sensitive",
    affected: [],
    agents: [{ agentId: "ag1", agentName: "Registrar assistant", teamId: "t1", teamSlug: "registrar", teamName: "Office of the Registrar", modelName: "Open-only model", modelMaxClassification: "open", audience: "team", reasons: ["model"] }],
  };
  const sourceRoutes = (extra: Record<string, Handler> = {}) => ({
    ...shellRoutes(),
    "GET /v1/teams/registrar/sources/s1": () => source,
    "GET /v1/teams/registrar/sources/s1/documents": () => ({ items: [doc], nextCursor: null }),
    ...extra,
  });

  it("raising a team source's classification explains which agents block it", async () => {
    mockApi(sourceRoutes({ "PATCH /v1/teams/registrar/sources/s1": () => Reply.error(409, "classification_impact", "Blocked", impact) }));
    // Deep link to the Settings tab.
    const { container } = renderApp("/teams/registrar/sources/s1?tab=settings");
    await screen.findByRole("option", { name: "Sensitive" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Classification" }), "sensitive");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const dialog = await screen.findByRole("dialog", { name: /Can't raise the classification to Sensitive/ });
    const table = within(dialog).getByRole("table", { name: "Published agents that block the change" });
    expect(within(table).getByRole("link", { name: "Registrar assistant" })).toHaveAttribute("href", "/teams/registrar/agents/ag1");
    expect(table).toHaveTextContent("Its chat model, Open-only model, is approved only up to open.");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("edits a document's tags", async () => {
    const calls = mockApi(
      sourceRoutes({
        "GET /v1/teams/registrar/sources/s1/documents/d1": () => doc,
        "GET /v1/teams/registrar/sources/s1/documents/d1/passages": () => ({ items: [], total: 2 }),
        "PATCH /v1/teams/registrar/sources/s1/documents/d1": (b) => ({ ...doc, ...(b as object) }),
      }),
    );
    renderApp("/teams/registrar/sources/s1?tab=documents");
    const table = await screen.findByRole("table", { name: "Documents" });
    // Tags are edited in the document sheet, from the row's "…" menu.
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Drop/Add" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit tags" }));
    const dialog = await screen.findByRole("region", { name: "Drop/Add" });
    expect(within(dialog).getByText("policy")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Tags" }), "Fees{Enter}");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save tags" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ tags: ["policy", "fees"] }));
  });

  it("uploads send tags before the files", async () => {
    const sent: FormData[] = [];
    class FakeXHR {
      upload = { onprogress: null };
      status = 200;
      responseText = JSON.stringify({ data: [] });
      onload: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send(body: FormData) {
        sent.push(body);
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    await uploadFiles({ path: "/x", files: [new File(["a"], "a.pdf")], csrfToken: "t", onProgress: () => {}, tags: ["fees", "policy"] });
    expect([...sent[0]!.keys()]).toEqual(["tags", "tags", "files"]);
  });

  it("attaching a source explains blocking agents, and deleting a KB used by agents names them", async () => {
    const kbDetail = { ...kb("kb1", "Registrar help"), sources: [] };
    mockApi({
      ...shellRoutes(),
      "GET /v1/teams/registrar/kbs/kb1": () => kbDetail,
      "GET /v1/teams/registrar/sources": () => [{ ...source, classification: "sensitive" }],
      "GET /v1/shared-sources": () => [],
      "GET /v1/embedding-profiles": () => [{ id: "p1", key: "p1", name: "Nomic", description: "", dimensions: 768, chunkSize: 512, maxClassification: "restricted", isDefault: true }],
      "PUT /v1/teams/registrar/kbs/kb1/sources/s1": () => Reply.error(409, "classification_impact", "Blocked", impact),
      "DELETE /v1/teams/registrar/kbs/kb1": () =>
        Reply.error(409, "kb_in_use", "Published agents use this knowledge base: Registrar assistant.", { agents: [{ id: "ag1", name: "Registrar assistant", slug: "registrar-assistant" }] }),
    });
    const { router } = renderApp("/teams/registrar/kbs/kb1?tab=sources");
    // The card's header button (the empty list offers the same action).
    await userEvent.click((await screen.findAllByRole("button", { name: "Attach source" }))[0]!);
    const picker = await screen.findByRole("dialog", { name: /Attach a source/ });
    await userEvent.click(await within(picker).findByRole("button", { name: "Attach source" }));
    // The explanation opens at once; the alert stays behind with a button to reopen it.
    const dialog = await screen.findByRole("dialog", { name: /Can't attach Registrar website yet/ });
    expect(within(dialog).getByRole("link", { name: "Registrar assistant" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText(/1 published agent using it can't serve that level/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show which agents" })).toBeInTheDocument();

    // Switching tabs updates ?tab= (a history entry, so Back returns to Data sources).
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: "settings" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete knowledge base" }));
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete knowledge base" }));
    expect(await within(confirm).findByText("Published agents use this knowledge base")).toBeInTheDocument();
    expect(within(confirm).getByRole("link", { name: "Registrar assistant" })).toHaveAttribute("href", "/teams/registrar/agents/ag1");
  });
});
