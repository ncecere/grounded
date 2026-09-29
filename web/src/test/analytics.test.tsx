import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { dailySummary, moderationByCategory } from "../components/analytics/format";
import { mockApi, renderApp, shellRoutes } from "./harness";

/** A local calendar day n days ago (the date-range presets use local days). */
const daysAgoLocal = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* Admin → Analytics (docs/phase4-publishing.md §9): groups, chart and table, CSV link, empty state, axe; and the pure helpers. */

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => vi.unstubAllGlobals());

const day = (date: string, answers: number, conversations: number): Schemas["PlatformAnalyticsDay"] => ({
  date, answers, conversations, noContext: 1, refused: 0, moderationBlocked: answers > 50 ? 2 : 0, moderationFlagged: 0,
});

const overview: Schemas["PlatformAnalytics"] = {
  from: "2026-09-24",
  to: "2026-09-26",
  totals: {
    answers: 160, conversations: 51, uniqueUsers: 38, up: 30, down: 10, satisfaction: 0.75, noContextRate: 0.12, refusalRate: 0.03, errorRate: 0.01,
    latencyP50Ms: 2100, latencyP95Ms: 5400, firstTokenP50Ms: 640, moderation: { questionsBlocked: 4, answersWithheld: 1, flagged: 6, supported: 0 },
    judging: { answers: 0, candidates: 0, evidence: 0, conflicting: 0, kept: 0, dropped: { injection: 0, irrelevant: 0, notUsable: 0 }, skipped: 0, judgedOut: 0, requests: 0, latencyP50Ms: null, latencyP95Ms: null },
    citations: { answers: 0, pairs: 0, verified: 0, unsupported: 0, contradicted: 0, unchecked: 0, lowConfidence: 0, removed: 0, refused: 0, supportRate: null, latencyP50Ms: null, latencyP95Ms: null, supportedClaims: 0, notSupportedClaims: 0, uncitedClaims: 0, claimSupportRate: null },
    scope: { checked: 0, smallTalk: 0, outOfScope: 0, refused: 0, skipped: 0, latencyP50Ms: null },
  },
  audiences: [
    { audience: "public", answers: 80, share: 0.5 },
    { audience: "team", answers: 48, share: 0.3 },
    { audience: "all_authenticated", answers: 32, share: 0.2 },
  ],
  channels: [
    { channel: "ui", answers: 70, share: 0.4375 },
    { channel: "widget", answers: 50, share: 0.3125 },
    { channel: "public", answers: 30, share: 0.1875 },
    { channel: "api", answers: 10, share: 0.0625 },
  ],
  moderation: [
    { stage: "input", decision: "block", category: "violence", count: 4 },
    { stage: "output", decision: "block", category: "sexual", count: 1 },
    { stage: "input", decision: "flag", category: "personal_data", count: 6 },
  ],
  models: [
    { modelId: "m1", modelName: "Chat large", kind: "chat", chatInputTokens: 420000, chatOutputTokens: 51000, embeddingTokens: 0 },
    { modelId: "m2", modelName: "Embed", kind: "embedding", chatInputTokens: 0, chatOutputTokens: 0, embeddingTokens: 90000 },
    { modelId: "m3", modelName: "", kind: "", chatInputTokens: 10, chatOutputTokens: 5, embeddingTokens: 0 },
  ],
  topAgents: [
    { agentId: "a1", agentSlug: "help", agentName: "Registrar help", teamId: "t1", teamSlug: "registrar", teamName: "Registrar", deleted: false, answers: 120, noContextRate: 0.1, satisfaction: 0.8, citationSupportRate: 0.91 },
    { agentId: "a2", agentSlug: "", agentName: "", teamId: "t2", teamSlug: "", teamName: "", deleted: true, answers: 40, noContextRate: 0.2, satisfaction: null, citationSupportRate: null },
  ],
  topTeams: [{ teamId: "t1", teamSlug: "registrar", teamName: "Registrar", answers: 120, agents: 1 }],
  daily: [day("2026-09-24", 20, 8), day("2026-09-25", 0, 0), day("2026-09-26", 140, 43)],
};

describe("admin analytics page", () => {
  it("reads the range from the URL (Q13)", async () => {
    const calls = mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/admin/analytics": () => overview });
    renderApp("/admin/analytics?range=7d");
    expect(await screen.findByRole("heading", { name: "Analytics", level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.url === "/v1/admin/analytics")?.search.get("from")).toBe(daysAgoLocal(6)));
  });

  it("filters by team and audience from the URL, in the query and the CSV (A9)", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/analytics": () => overview,
      "GET /v1/admin/models": () => [],
      "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0 }),
      "GET /v1/admin/teams": () => ({ items: [{ team: { id: "t1", slug: "registrar", name: "Office of the Registrar" } }], nextCursor: null }),
    });
    const { router, container } = renderApp("/admin/analytics?team=registrar&audience=public");
    await waitFor(() => {
      const q = calls.find((c) => c.url === "/v1/admin/analytics")?.search;
      expect([q?.get("team"), q?.get("audience")]).toEqual(["registrar", "public"]);
    });
    expect(await screen.findByRole("link", { name: "Download CSV" })).toHaveAttribute("href", "/v1/admin/analytics/daily.csv?from=2026-09-24&to=2026-09-26&team=registrar&audience=public");
    const filters = screen.getByRole("group", { name: "Analytics filters" });
    expect(within(filters).getByRole("combobox", { name: "Audience" })).toHaveTextContent("Public");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(filters).getByRole("combobox", { name: "Audience" }));
    await userEvent.click(await screen.findByRole("option", { name: "All audiences" }));
    await waitFor(() => expect(router.state.location.searchStr).toBe("?team=registrar"));
  });

  it("shows grouped totals, the daily chart and table with a CSV link, breakdowns and top lists", async () => {
    const calls = mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/admin/analytics": () => overview });
    const { container } = renderApp("/admin/analytics");
    expect(await screen.findByRole("heading", { name: "Analytics", level: 1 })).toBeInTheDocument();
    const usage = await screen.findByRole("region", { name: "Usage" });
    expect(usage).toHaveTextContent(/Answers\s*160/);
    expect(usage).toHaveTextContent(/Unique users\s*38/);
    expect(usage).toHaveTextContent(/Public share\s*50%/);
    for (const group of ["Quality", "Speed", "Moderation"]) expect(screen.getByRole("region", { name: group })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Speed" })).toHaveTextContent(/Latency p95\s*5.4 s/);

    const chart = screen.getByRole("img", { name: /Answers per day from Sep 24, 2026 to Sep 26, 2026: 160 answers and 51 conversations.*busiest day was Sep 26, 2026 with 140/ });
    expect(chart).toBeInTheDocument();
    const daily = screen.getByRole("table", { name: "Answers and conversations per day" });
    expect(within(daily).getAllByRole("row")).toHaveLength(3); // header + the two days with activity
    expect(within(daily).getAllByRole("row")[2]).toHaveTextContent(/Sep 26, 2026\s*140\s*43\s*1\s*0\s*2\s*0/);
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute("href", "/v1/admin/analytics/daily.csv?from=2026-09-24&to=2026-09-26");

    expect(calls.find((c) => c.url === "/v1/admin/analytics")?.search.get("from")).toBe(daysAgoLocal(29));
    expect(await axe(container)).toHaveNoViolations();

    // A9: the rest is in pill tabs, and the range lives in the URL.
    await userEvent.click(screen.getByRole("tab", { name: "Breakdown" }));
    expect(await screen.findByRole("table", { name: "Answers per channel" })).toHaveTextContent(/Embedded widget\s*50\s*31.3%/);
    expect(screen.getByRole("table", { name: "Answers per audience" })).toHaveTextContent(/Signed-in users\s*32\s*20%/);
    expect(screen.getByRole("table", { name: "Blocked and flagged by category" })).toHaveTextContent(/Personal data\s*0\s*6\s*0\s*0/);
    await userEvent.click(screen.getByRole("tab", { name: "Models & tokens" }));
    expect(await screen.findByRole("table", { name: "Token use per model" })).toHaveTextContent(/Deleted model/);
    await userEvent.click(screen.getByRole("tab", { name: "Top agents & teams" }));
    const agents = await screen.findByRole("table", { name: "Agents with the most answers" });
    expect(within(agents).getByRole("link", { name: "Registrar help" })).toHaveAttribute("href", "/admin/agents?record=a1");
    expect(within(agents).getAllByRole("link", { name: "Registrar" })[0]).toHaveAttribute("href", "/admin/teams/registrar");
    expect(within(agents).getByText("Deleted agent")).toBeInTheDocument();
    expect(within(agents).getAllByRole("row")[1]).toHaveTextContent(/91%$/); // citation support rate
    expect(within(screen.getByRole("table", { name: "Teams with the most answers" })).getByRole("link", { name: "Registrar" })).toBeInTheDocument();
  }, 15_000);

  it("drills into moderation decisions: category, score and lowered blocks (F-02)", async () => {
    mockApi({
      ...shellRoutes("platform_auditor"),
      "GET /v1/admin/analytics": () => overview,
      "GET /v1/admin/analytics/moderation-events": () => ({
        items: [
          { id: 9, at: "2026-09-26T10:00:00Z", agentId: "a1", agentName: "Registrar help", agentSlug: "registrar-help", teamSlug: "registrar", agentDeleted: false,
            channel: "public", audience: "public", stage: "input", decision: "flag", topCategory: "illicit", score: 0.62, categories: ["illicit"],
            downgraded: ["illicit"], provider: "chat_classifier", calibrated: false, latencyMs: 900 },
        ],
        nextCursor: null,
      }),
    });
    const { container } = renderApp("/admin/analytics?tab=breakdown");
    await userEvent.click(await screen.findByRole("button", { name: "Show decisions" }));
    const table = await screen.findByRole("table", { name: "Moderation decisions" });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent(/Registrar help.*Question.*Flagged.*Block lowered to flag.*Illicit activity.*62%.*Not calibrated/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an empty state for a quiet range, with no axe violations", async () => {
    const empty: Schemas["PlatformAnalytics"] = {
      ...overview,
      totals: { ...overview.totals, answers: 0, conversations: 0, uniqueUsers: 0 },
      audiences: [], channels: [], moderation: [], models: [], topAgents: [], topTeams: [],
      daily: overview.daily.map((d) => ({ ...d, answers: 0, conversations: 0 })),
    };
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/analytics": () => empty });
    const { container } = renderApp("/admin/analytics");
    expect(await screen.findByText("No activity in this range.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download CSV" })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is in the admin sidebar under Oversight", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/analytics": () => overview });
    renderApp("/admin/analytics");
    expect(await screen.findByRole("link", { name: "Analytics" })).toHaveAttribute("href", "/admin/analytics");
  });
});

describe("analytics helpers", () => {
  it("pivots moderation counts by category and counts provider errors apart", () => {
    const { rows, errors } = moderationByCategory([
      { stage: "input", decision: "block", category: "violence", count: 2 },
      { stage: "output", decision: "flag", category: "violence", count: 1 },
      { stage: "input", decision: "flag", category: "personal_data", count: 5 },
      { stage: "output", decision: "error", category: "", count: 3 },
    ]);
    expect(rows).toEqual([
      { category: "personal_data", inputBlock: 0, inputFlag: 5, outputBlock: 0, outputFlag: 0 },
      { category: "violence", inputBlock: 2, inputFlag: 0, outputBlock: 0, outputFlag: 1 },
    ]);
    expect(errors).toEqual({ input: 0, output: 3 });
  });

  it("summarises a daily series", () => {
    expect(dailySummary([])).toBe("No days in this range.");
    expect(dailySummary([{ date: "2026-09-01", answers: 0, conversations: 0 }])).toBe("Answers per day from Sep 1, 2026 to Sep 1, 2026: none.");
    expect(dailySummary([{ date: "2026-09-01", answers: 3, conversations: 1 }, { date: "2026-09-02", answers: 1200, conversations: 9 }])).toBe(
      "Answers per day from Sep 1, 2026 to Sep 2, 2026: 1,203 answers and 10 conversations in total; the busiest day was Sep 2, 2026 with 1,200 answers.",
    );
  });
});
