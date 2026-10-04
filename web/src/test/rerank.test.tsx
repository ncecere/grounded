/* Cross-encoder reranking (docs/v0.4.0.md §3): the rerank model test, Try it, Build → Advanced and evaluation runs (the Reranking page: reranking-page.test.tsx). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { AdvancedSection } from "../pages/agents/build/advanced-section";
import { sectionSummary } from "../pages/agents/build/summaries";
import { initialModelForm, modelSpec } from "../pages/admin/models/model-form";
import { configChanges } from "../pages/team/evaluations/labels";
import { TeamContext, teamCtx } from "../pages/team/common";
import { RetrievePlayground } from "../pages/team/retrieve";
import { mockApi, renderApp, renderBare, shellRoutes, team } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const reranker = {
  id: "r1", connectionId: "c1", key: "bge-reranker", upstreamModel: "bge-reranker-v2-m3", displayName: "BGE reranker", description: "", kind: "rerank",
  maxClassification: "sensitive", enabled: true, supportsTools: false, supportsVision: false, compat: {}, maxInputTokens: 512,
  revision: 1, createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z",
};
const off: Schemas["RerankSettings"] = { modelId: null, candidates: 40, timeLimitMs: 2000, agents: 0, agentsOff: [], revision: 1, updatedAt: null };
const status = (available: boolean) => () => ({ available, defaultTopN: 6 });

describe("Admin → Models: rerank models", () => {
  it("tests a rerank model in place", async () => {
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => [],
      "GET /v1/admin/models": () => [reranker],
      "GET /v1/admin/rerank": () => ({ ...off, modelId: "r1", agents: 1, revision: 2 }),
      "GET /v1/admin/catalog-usage": () => ({ models: [{ modelId: "r1", publishedAgents: 0, draftAgents: 0, profiles: 0, moderationAudiences: [], systemOne: false, rerank: true }], profiles: [] }),
      "POST /v1/admin/models/r1/test": () => ({
        ok: true, latencyMs: 40,
        rerank: { query: "When does the library open on weekdays?", relevantText: "a", irrelevantText: "b", relevant: 0.982, irrelevant: 0.004 },
      }),
    });
    renderApp("/admin/models?record=r1");
    const sheet = await screen.findByRole("region", { name: "BGE reranker" }, { timeout: 4000 });
    expect(within(sheet).getByText("Reranking")).toBeInTheDocument();
    // Delete says why it's off, in words reachable without hovering, and what to do instead (adm-8).
    const del = within(sheet).getByRole("button", { name: "Delete" });
    expect(del).toBeDisabled();
    expect(del).toHaveAccessibleDescription(/choose None or another model on Admin → Models → Reranking first/);
    expect(within(sheet).getByText("Scores a passage that answers a sample question and one that doesn't.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Test model" }));
    expect(await within(sheet).findByText(/The answer scored 0.982; the unrelated passage 0.004./)).toBeInTheDocument();
  });

  it("sends the rerank compatibility flags for rerank models only", () => {
    const form = { ...initialModelForm(null, []), kind: "rerank" as const, rerankDocumentsField: "texts" as const, supportsRerankTopN: false };
    expect(modelSpec(form).compat).toEqual({ rerankDocumentsField: "texts", supportsRerankTopN: false });
    expect(modelSpec({ ...form, kind: "chat" }).compat).toEqual({});
  });
});

const hit = (n: number, rerankScore?: number): Schemas["RetrieveHit"] => ({
  chunkId: `c${n}`, documentId: `d${n}`, sourceId: "src", content: `Passage ${n}`, headingPath: [], title: `Page ${n}`, filename: "", url: "", score: 0.03 - n / 1000,
  rerankScore,
});

describe("Try it reranking", () => {
  it("shows each passage's rerank score and compares without reranking", async () => {
    const calls = mockApi({
      "GET /v1/systemone/status": () => ({ available: false, judging: { enabled: false, candidates: 10 }, citations: { enabled: false, mode: "annotate" }, scope: { enabled: false } }),
      "GET /v1/rerank/status": status(true),
      "POST /v1/teams/registrar/kbs/k1/retrieve": (body) =>
        (body as { rerank?: boolean }).rerank === false
          ? { latencyMs: 20, hits: [hit(2), hit(1)] }
          : { latencyMs: 180, rerank: { status: "ok", candidates: 40, latencyMs: 120 }, hits: [hit(1, 0.9731), hit(2, 0.41)] },
    });
    const { container } = renderBare(
      <TeamContext.Provider value={teamCtx(team as never, "member")}>
        <RetrievePlayground kbId="k1" defaultTopK={6} />
      </TeamContext.Provider>,
    );
    await userEvent.type(await screen.findByRole("textbox", { name: "Question or search terms" }), "transcript fee");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Reranked the best 40 passages in 120 ms.")).toBeInTheDocument();
    const cards = within(screen.getByRole("list", { name: "Search results" })).getAllByRole("article");
    expect(cards[0]).toHaveTextContent("Rerank 0.973");
    expect(calls.at(-1)?.body).toEqual({ query: "transcript fee" });
    expect(await axe(container)).toHaveNoViolations();
    // Switching Rerank searches again (own-13): no results from the other setting stay under the switch.
    const searches = calls.filter((c) => c.method === "POST").length;
    await userEvent.click(screen.getByRole("switch", { name: /Rerank/ }));
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ query: "transcript fee", rerank: false }));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(searches + 1);
    await waitFor(() => expect(screen.queryByText(/Reranked the best/)).toBeNull());
    await userEvent.click(screen.getByRole("switch", { name: /Rerank/ }));
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ query: "transcript fee" }));
    expect(await screen.findByText("Reranked the best 40 passages in 120 ms.")).toBeInTheDocument();
  });

  it("says when reranking failed and the usual order was kept", async () => {
    mockApi({
      "GET /v1/rerank/status": status(true),
      "POST /v1/teams/registrar/kbs/k1/retrieve": () => ({ latencyMs: 2100, rerank: { status: "timeout", candidates: 40, latencyMs: 2000 }, hits: [hit(1)] }),
    });
    renderBare(
      <TeamContext.Provider value={teamCtx(team as never, "member")}>
        <RetrievePlayground kbId="k1" defaultTopK={6} />
      </TeamContext.Provider>,
    );
    await userEvent.type(await screen.findByRole("textbox", { name: "Question or search terms" }), "fee");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Reranking took too long, so the results keep the usual order.")).toBeInTheDocument();
  });
});

describe("agents and evaluations", () => {
  it("Build → Advanced turns reranking off and sets the passages kept", async () => {
    mockApi({ "GET /v1/rerank/status": status(true) });
    const set = vi.fn();
    const c = { contextTokenBudget: 6000, queryRewrite: true, minSimilarity: 0, retrievalMode: "always", rerank: true, rerankTopN: 6 } as Schemas["AgentConfig"];
    const { container } = renderBare(<AdvancedSection c={c} set={set} errorFor={() => undefined} model={undefined} levelName={(k) => k} />);
    const kept = await screen.findByRole("textbox", { name: "Passages kept after reranking" });
    await userEvent.clear(kept);
    await userEvent.type(kept, "4");
    expect(set).toHaveBeenLastCalledWith({ rerankTopN: 4 });
    await userEvent.click(screen.getByRole("switch", { name: /Rerank passages/ }));
    expect(set).toHaveBeenLastCalledWith({ rerank: false });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Build → Advanced shows no reranking without a rerank model", async () => {
    mockApi({ "GET /v1/rerank/status": status(false) });
    const c = { contextTokenBudget: 6000, queryRewrite: true, minSimilarity: 0, retrievalMode: "always" } as Schemas["AgentConfig"];
    renderBare(<AdvancedSection c={c} set={() => {}} errorFor={() => undefined} model={undefined} levelName={(k) => k} />);
    await screen.findByRole("switch", { name: /Rewrite follow-up questions/ });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("switch", { name: /Rerank passages/ })).toBeNull();
  });

  it("summarises an agent that turned reranking off, and marks runs that changed it", () => {
    const c = { contextTokenBudget: 6000, queryRewrite: true, minSimilarity: 0, rerank: false } as Schemas["AgentConfig"];
    expect(sectionSummary("advanced", { c, kbName: () => undefined })).toContain("no reranking");
    const run = (rerank?: "on" | "off") => ({ config: { kbs: [], resultsPerSearch: 6, rerank } }) as unknown as Schemas["EvaluationRun"];
    expect(configChanges(run("on"), run("off"))).toEqual(["not reranked"]);
    expect(configChanges(run("off"), run("on"))).toEqual(["reranked"]);
    expect(configChanges(run(undefined), run(undefined))).toEqual([]);
  });
});
