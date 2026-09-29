/*
 * Quality and spend in the team workspace (docs/v0.2.1.md I3, I4): the team's
 * Evaluations page and sidebar item, the Overview's "Quality & spend" row,
 * Team settings' "Usage & spend" tab and an agent's spend this month.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { type Handler, Reply, meFor, mockApi, renderApp, shellRoutes } from "./harness";
import { set as baseSet } from "./evaluations-fixtures";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => vi.unstubAllGlobals());

type EvalSet = Schemas["EvaluationSet"];
const summary = (recall: number): Schemas["EvaluationSummary"] => ({
  k: 4, questions: 3, passed: 2, failed: 1, missing: 0, notIndexed: 0, errors: 0, recall, mrr: 0.5, cited: 0, citedOnly: 0, refused: 0,
});
const brief = (id: string, recall: number, at: string): EvalSet["lastRun"] => ({ id, kind: "retrieval", status: "completed", summary: summary(recall), createdAt: at });

const sets: EvalSet[] = [
  { ...baseSet, id: "steady", name: "Steady set", lastRun: brief("r1", 0.9, "2026-09-28T10:00:00Z"), previousRun: brief("r0", 0.85, "2026-09-27T10:00:00Z") },
  {
    ...baseSet,
    id: "dropped",
    name: "Transcript questions",
    target: { type: "agent", id: "ag1", name: "Registrar helper" },
    lastRun: brief("r3", 0.7, "2026-09-26T10:00:00Z"),
    previousRun: brief("r2", 0.8, "2026-09-25T10:00:00Z"),
  },
  { ...baseSet, id: "new", name: "Never run", lastRun: null, previousRun: null },
];

const status = (extra: Partial<Schemas["TeamBudgetState"]> = {}): Schemas["TeamBudgetState"] => ({
  mode: "enforce", state: "ok", enforced: true, currency: "USD", month: "2026-09-01", resetsAt: "2026-10-01T04:00:00Z", budget: "1.200000",
  extensions: "0.000000", limit: "1.200000", spent: "0.240000", percent: 19, warnPercent: 80, ...extra,
});
const byKind = { chat: "0.240000", embedding: "0.000000", systemone: "0.000000", moderation: "0.000000", ocr: "0.000000" };
const spend: Schemas["TeamSpend"] = {
  status: status(), timeZone: "UTC", from: "2026-09-01", to: "2026-09-29",
  total: { spend: "0.240000", byKind, tokens: 5000, requests: 0, unpriced: false },
  agents: [{ key: "ag1", label: "Registrar helper", deleted: false, spend: "0.180000", byKind, tokens: 4000, requests: 2, unpriced: false }],
  models: [],
};

function routes(opts: { teamRole?: string; evaluations?: boolean; sets?: EvalSet[]; costs?: boolean } = {}): Record<string, Handler> {
  const role = opts.teamRole ?? "owner";
  const me = meFor("none", role);
  return {
    ...shellRoutes("none", role),
    "GET /v1/me": () => ({ ...me, capabilities: { ...me.capabilities, evaluations: opts.evaluations ?? true } }),
    "GET /v1/teams/registrar/sources": () => [],
    "GET /v1/teams/registrar/kbs": () => [],
    "GET /v1/teams/registrar/agents": () => [],
    "GET /v1/teams/registrar/limits": () => ({ items: [] }),
    "GET /v1/teams/registrar/members": () => [],
    "GET /v1/teams/registrar/invites": () => [],
    "GET /v1/teams/registrar/audit": () => ({ items: [], nextCursor: null }),
    "GET /v1/teams/registrar/domain-requests": () => [],
    "GET /v1/teams/registrar/evaluation-sets": () => opts.sets ?? sets,
    "GET /v1/teams/registrar/spend": () => (opts.costs === false ? Reply.error(404, "costs_off", "Cost tracking is off for this team") : spend),
  };
}

const T = { timeout: 3000 };

describe("the team's Evaluations page (I3)", () => {
  it("lists every set with its target, questions, latest score and trend, and filters regressions", async () => {
    const calls = mockApi(routes({ teamRole: "editor" }));
    const { container, router } = renderApp("/teams/registrar/evaluations");
    const table = await screen.findByRole("table", { name: "Evaluation sets" }, T);
    expect(screen.getByRole("heading", { level: 1, name: "Evaluations" })).toBeInTheDocument();
    // One request for the whole team: no knowledge base or agent filter.
    const list = calls.find((c) => c.url === "/v1/teams/registrar/evaluation-sets")!;
    expect([...list.search.keys()]).toEqual([]);
    expect(await within(table).findByRole("link", { name: "Transcript questions" }, T)).toHaveAttribute("href", "/teams/registrar/evaluations/dropped");
    expect(within(table).getByRole("link", { name: "Registrar helper" })).toHaveAttribute("href", "/teams/registrar/agents/ag1?tab=evaluations");
    expect(within(table).getByText("Down 10 points from 80%")).toBeInTheDocument();
    expect(within(table).getByText("Up 5 points from 85%")).toBeInTheDocument();
    // Never run: the score says so, and so does the trend to a screen reader (not "no earlier run").
    expect(within(table).getAllByText("Not run yet")).toHaveLength(2);
    // The Evaluations tabs' columns, plus the knowledge base or agent; the name is the row's only link (no menu repeating it).
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Set", "Knowledge base or agent", "Questions", "Score", "Trend"]);
    expect(within(table).queryByRole("button", { name: /^Actions for/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Columns" })).toBeNull();
    // The sidebar item is current, and the breadcrumb names the page.
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Evaluations" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/Office of the Registrar.*Evaluations/);
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: /^Regressions, 1/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ trend: "down" }));
    await waitFor(() => expect(within(table).queryByRole("link", { name: "Steady set" })).toBeNull());
    expect(within(table).getByRole("link", { name: "Transcript questions" })).toBeInTheDocument();
  });

  it("says no set got worse when Regressions matches none", async () => {
    mockApi(routes({ teamRole: "editor", sets: sets.filter((x) => x.id !== "dropped") }));
    const { container } = renderApp("/teams/registrar/evaluations?trend=down");
    expect(await screen.findByText("No set got worse since its previous run.", {}, T)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is not found for members, who have no sidebar item", async () => {
    const calls = mockApi(routes({ teamRole: "member" }));
    renderApp("/teams/registrar/evaluations");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" }, T)).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Main" })).queryByRole("link", { name: "Evaluations" })).toBeNull();
    expect(calls.some((c) => c.url.endsWith("/evaluation-sets"))).toBe(false);
  });

  it("has no sidebar item while evaluations are off", async () => {
    mockApi(routes({ evaluations: false }));
    renderApp("/teams/registrar");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Agents" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Evaluations" })).toBeNull();
  });
});

describe("the Overview's Quality & spend (I3)", () => {
  it("shows owners the scores, regressions first, and this month's spend", async () => {
    mockApi(routes());
    const { container } = renderApp("/teams/registrar");
    const row = await screen.findByRole("region", { name: "Quality & spend" }, T);
    const scores = await within(row).findByRole("table", { name: "Latest evaluation scores" });
    const names = within(scores).getAllByRole("link").map((l) => l.textContent);
    expect(names).toEqual(["Transcript questions", "Steady set", "Never run"]);
    expect(within(row).getByText("1 set scored lower than the run before.")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "All evaluations" })).toHaveAttribute("href", "/teams/registrar/evaluations");
    const strip = await within(row).findByText(/^of .* this month$/);
    expect(strip.closest("p")).toHaveTextContent("$0.24 of $1.20 this month · 19% · Within budget · resets Oct 1");
    expect(within(row).getByRole("meter", { name: "Share of this month's budget used" })).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Spend breakdown" })).toHaveAttribute("href", "/teams/registrar/settings?tab=usage");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows editors quality only, and an empty state without sets", async () => {
    const calls = mockApi(routes({ teamRole: "editor", sets: [] }));
    renderApp("/teams/registrar");
    const row = await screen.findByRole("region", { name: "Quality & spend" }, T);
    expect(await within(row).findByText("No evaluation sets yet.")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Create a set from a knowledge base" })).toHaveAttribute("href", "/teams/registrar/kbs");
    expect(within(row).queryByText("Spend this month")).toBeNull();
    expect(calls.some((c) => c.url.endsWith("/spend"))).toBe(false);
  });

  it("shows members neither", async () => {
    const calls = mockApi({ ...routes({ teamRole: "member" }), "GET /v1/agents": () => [] });
    renderApp("/teams/registrar");
    await screen.findByRole("heading", { level: 1, name: "Office of the Registrar" }, T);
    expect(screen.queryByRole("region", { name: "Quality & spend" })).toBeNull();
    expect(calls.some((c) => c.url.endsWith("/evaluation-sets") || c.url.endsWith("/spend"))).toBe(false);
  });

  it("leaves the spend out while cost tracking is off", async () => {
    mockApi(routes({ costs: false }));
    renderApp("/teams/registrar");
    const row = await screen.findByRole("region", { name: "Quality & spend" }, T);
    expect(await within(row).findByRole("table", { name: "Latest evaluation scores" })).toBeInTheDocument();
    expect(within(row).queryByText("Spend this month")).toBeNull();
  });
});

describe("Usage & spend (I4)", () => {
  it("names the tab Usage & spend for owners while cost tracking is on", async () => {
    mockApi(routes());
    renderApp("/teams/registrar/settings?tab=usage");
    expect(await screen.findByRole("tab", { name: "Usage & spend", selected: true }, T)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/Team settings.*Usage & spend/);
  });

  it("keeps Usage & limits while it's off", async () => {
    mockApi(routes({ costs: false }));
    renderApp("/teams/registrar/settings?tab=usage");
    expect(await screen.findByRole("tab", { name: "Usage & limits", selected: true }, T)).toBeInTheDocument();
  });

  it("shows owners an agent's spend this month on its Analytics tab", async () => {
    const agent = { id: "ag1", teamSlug: "registrar", slug: "helper", name: "Registrar helper", description: "", status: "active", audience: "team", published: null };
    mockApi({
      ...routes(),
      "GET /v1/teams/registrar/agents/ag1/analytics": () => ({ totals: null }),
    });
    const { AgentSpendCard } = await import("../pages/agents/analytics/spend");
    const { renderWith } = await import("./web-harness");
    const { container } = renderWith(<AgentSpendCard agent={agent} />, { role: "owner" });
    expect(await screen.findByRole("heading", { name: "Spend this month" }, T)).toBeInTheDocument();
    expect(screen.getByText("$0.18")).toBeInTheDocument();
    expect(screen.getByText("75% of the team's spend")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows editors no agent spend", async () => {
    const calls = mockApi(routes());
    const { AgentSpendCard } = await import("../pages/agents/analytics/spend");
    const { renderWith } = await import("./web-harness");
    const { container } = renderWith(<AgentSpendCard agent={{ id: "ag1" }} />, { role: "editor" });
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
    expect(calls.some((c) => c.url.endsWith("/spend"))).toBe(false);
  });
});
