/*
 * The SystemOne cards in their own Checks tab (admin Analytics) and view (an
 * agent's Analytics), shown only while a SystemOne model is configured
 * (docs/v0.2.1.md I8); Overview has the chart first and keeps the rest.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { type Handler, mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const status = (available: boolean) => ({ available, judging: { enabled: available, candidates: 10 }, citations: { enabled: available, mode: "annotate" }, scope: { enabled: false } });
const judging = { answers: 6, candidates: 60, evidence: 20, conflicting: 2, kept: 22, dropped: { injection: 1, irrelevant: 30, notUsable: 7 }, skipped: 0, judgedOut: 1, requests: 6, latencyP50Ms: 800, latencyP95Ms: 1200 };
const citations = { answers: 8, pairs: 30, verified: 24, unsupported: 4, contradicted: 1, unchecked: 1, lowConfidence: 2, removed: 0, refused: 0, supportRate: 24 / 29, latencyP50Ms: 1900, latencyP95Ms: 3500 };
const scope = { checked: 0, smallTalk: 0, outOfScope: 0, refused: 0, skipped: 0, latencyP50Ms: null };
const totals = {
  answers: 10, conversations: 4, uniqueUsers: 3, up: 1, down: 0, satisfaction: 1, noContextRate: 0.1, refusalRate: 0, errorRate: 0,
  latencyP50Ms: 3000, latencyP95Ms: 5000, firstTokenP50Ms: 800, moderation: { questionsBlocked: 0, answersWithheld: 0, flagged: 0, supported: 0 }, judging, citations, scope,
};
const platform = {
  from: "2026-09-24", to: "2026-09-26", totals, audiences: [], channels: [], moderation: [], models: [], topAgents: [], topTeams: [],
  daily: [{ date: "2026-09-26", answers: 10, conversations: 4, noContext: 1, refused: 0, moderationBlocked: 0, moderationFlagged: 0 }],
};
const systemOneRegions = ["Passage judging (SystemOne)", "Citation checks (SystemOne)"];

describe("admin Analytics › Checks", () => {
  it("moves the SystemOne cards to Checks and puts the chart first on Overview", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/systemone/status": () => status(true), "GET /v1/admin/analytics": () => platform });
    const { container, router } = renderApp("/admin/analytics");
    const usage = await screen.findByRole("region", { name: "Usage" });
    const chart = screen.getByRole("img", { name: /Answers per day/ });
    expect(chart.compareDocumentPosition(usage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of systemOneRegions) expect(screen.queryByRole("region", { name })).toBeNull();

    await userEvent.click(await screen.findByRole("tab", { name: "Checks" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "checks" }));
    for (const name of systemOneRegions) expect(await screen.findByRole("region", { name })).toBeInTheDocument();
    // Nothing was scope-checked: its group stays out.
    expect(screen.queryByRole("region", { name: "Scope check (SystemOne)" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Usage" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no Checks tab without a SystemOne model", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/systemone/status": () => status(false), "GET /v1/admin/analytics": () => platform });
    renderApp("/admin/analytics?tab=checks");
    // A link to the hidden tab opens Overview.
    expect(await screen.findByRole("region", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview", selected: true })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Checks" })).toBeNull();
    for (const name of systemOneRegions) expect(screen.queryByRole("region", { name })).toBeNull();
  });
});

const config: Schemas["AgentConfig"] = {
  instructions: "Help students.", chatModelId: "mod1", kbs: [], retrievalMode: "always", maxTurns: 4, contextTokenBudget: 6000, minSimilarity: 0, strictlyGrounded: true,
  refusalMessage: "I couldn't find that.", citationMode: "snippet_link", queryRewrite: true, moderation: { categories: {}, outputMode: "" }, audience: "team",
};
const agent: Schemas["Agent"] = {
  id: "ag1", teamId: "t1", teamSlug: "registrar", slug: "helper", name: "Helper", description: "", accentColor: "", welcomeMessage: "", starterQuestions: [], status: "active",
  disabledReason: "", disabledAt: null, audience: "team", draft: config, draftRevision: 1, published: null, hasUnpublishedChanges: true, warnings: [], revision: 2,
  createdAt: "2026-09-26T09:00:00Z", updatedAt: "2026-09-26T10:00:00Z",
};
const agentAnalytics = {
  from: "2026-09-01", to: "2026-09-26", totals, daily: [{ date: "2026-09-26", conversations: 4, answers: 10 }], models: [], topDocuments: [], feedbackReasons: [], channels: [], audiences: [], moderation: [],
};
const agentRoutes = (available: boolean): Record<string, Handler> => ({
  ...shellRoutes(),
  "GET /v1/systemone/status": () => status(available),
  "GET /v1/teams/registrar/agents": () => [agent],
  "GET /v1/teams/registrar/agents/ag1": () => agent,
  "GET /v1/teams/registrar/agents/ag1/versions": () => [],
  "GET /v1/teams/registrar/agents/ag1/analytics": () => agentAnalytics,
  "GET /v1/chat-models": () => [],
  "GET /v1/teams/registrar/kbs": () => [],
});

describe("an agent's Analytics › Checks", () => {
  it("shows the SystemOne cards in Checks, not in Quality", async () => {
    mockApi(agentRoutes(true));
    const { container, router } = renderApp("/teams/registrar/agents/ag1?tab=analytics&view=quality");
    expect(await screen.findByRole("region", { name: "Answers" }, { timeout: 5000 })).toBeInTheDocument();
    for (const name of systemOneRegions) expect(screen.queryByRole("region", { name })).toBeNull();
    const views = screen.getByRole("group", { name: "Analytics section" });
    await userEvent.click(within(views).getByRole("button", { name: "Checks" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ view: "checks" }));
    for (const name of systemOneRegions) expect(await screen.findByRole("region", { name })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no Checks view without a SystemOne model", async () => {
    mockApi(agentRoutes(false));
    renderApp("/teams/registrar/agents/ag1?tab=analytics&view=checks");
    expect(await screen.findByRole("region", { name: "Key figures" }, { timeout: 5000 })).toBeInTheDocument();
    const views = screen.getByRole("group", { name: "Analytics section" });
    expect(within(views).queryByRole("button", { name: "Checks" })).toBeNull();
    expect(within(views).getByRole("button", { name: "Usage" })).toHaveAttribute("aria-pressed", "true");
  });
});
