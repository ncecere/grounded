/* Admin → Models → Reranking (docs/v0.4.2.md OW-2): status, the setup guide, the settings with the health warning (AD-06), the test, and the Overview row. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { rerankSteps } from "../pages/admin/reranking/guide";
import { rerankProblems, unhealthyReason } from "../pages/admin/reranking/settings";
import { offReason } from "../pages/admin/reranking/status";
import { rerankOutcome } from "../pages/admin/reranking/test";
import { rerankFeature } from "../pages/admin/overview/feature-text";
import { type Handler, mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const reranker = {
  id: "r1", connectionId: "c1", key: "bge-reranker", upstreamModel: "bge-reranker-v2-m3", displayName: "BGE reranker", description: "", kind: "rerank",
  maxClassification: "sensitive", enabled: true, supportsTools: false, supportsVision: false, compat: {}, revision: 1, createdAt: "", updatedAt: "",
};
const conn = { id: "c1", name: "Gateway", baseUrl: "http://gateway.example.edu/v1", enabled: true, modelCount: 1, revision: 1 };
const off: Schemas["RerankSettings"] = { modelId: null, candidates: 40, timeLimitMs: 2000, agents: 0, agentsOff: [], revision: 1, updatedAt: null };
const healthy = { subjectKind: "model", subjectId: "r1", subjectEnabled: true, status: "healthy", checkedAt: "2026-10-01T10:00:00Z", statusSince: "2026-10-01T10:00:00Z", latencyMs: 80, trigger: "manual" };

const routes = (extra: Record<string, Handler> = {}, role: "platform_admin" | "platform_auditor" = "platform_admin"): Record<string, Handler> => ({
  ...shellRoutes(role),
  "GET /v1/admin/connections": () => [conn],
  "GET /v1/admin/models": () => [reranker],
  "GET /v1/admin/health-checks": () => [],
  "GET /v1/admin/rerank": () => off,
  ...extra,
});

describe("Admin → Models → Reranking", () => {
  it("guides the setup step by step, with a button for each step", async () => {
    mockApi(routes({ "GET /v1/admin/models": () => [] }));
    const { container } = renderApp("/admin/reranking");
    const guide = (await screen.findByRole("heading", { name: "Set up reranking" }, { timeout: 4000 })).closest("section")!;
    expect(within(guide).getByText("1 of 3 done")).toBeInTheDocument();
    expect(within(guide).getByRole("link", { name: /How to deploy a reranker/ })).toHaveAttribute("href", expect.stringContaining("docs/operations/rerank.md"));
    expect(within(guide).getByRole("link", { name: "Add model" })).toHaveAttribute("href", "/admin/models?form=new&kind=rerank&from=reranking");
    const status = screen.getByRole("heading", { name: "Status" }).closest("section")!;
    expect(within(status).getByText("Off")).toBeInTheDocument();
    expect(within(status).getByText("No rerank model is chosen.")).toBeInTheDocument();
    expect(screen.getByText("Choose a rerank model and save the settings to test it.")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("warns about a model that hasn't been tested, and asks before saving it (AD-06)", async () => {
    const calls = mockApi(routes({ "PUT /v1/admin/rerank": (body) => ({ ...off, ...(body as object), agents: 3, revision: 2 }) }));
    renderApp("/admin/reranking");
    const select = await screen.findByRole("combobox", { name: /Rerank model/ }, { timeout: 4000 });
    expect(within(select).getByRole("option", { name: "BGE reranker (bge-reranker-v2-m3) · Not tested" })).toBeInTheDocument();
    // Until a model is chosen the guide stays, its third step current (AD2-06).
    const guide = screen.getByRole("heading", { name: "Set up reranking" }).closest("section")!;
    expect(within(guide).getByText("2 of 3 done")).toBeInTheDocument();
    expect(within(guide).getByRole("link", { name: "Choose the model" })).toHaveAttribute("href", "#settings");
    await userEvent.selectOptions(select, "r1");
    expect(await screen.findByText(/BGE reranker hasn't been tested\. Until it works, every search waits for it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Rerank with BGE reranker?" });
    expect(await axe(confirm)).toHaveNoViolations();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    await userEvent.click(within(confirm).getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ modelId: "r1", candidates: 40, timeLimitMs: 2000 }));
    expect(calls.find((c) => c.method === "PUT")?.headers.get("If-Match")).toBe('"1"');
  });

  it("saves a healthy model without asking, and checks every field first", async () => {
    const calls = mockApi(routes({ "GET /v1/admin/health-checks": () => [healthy], "PUT /v1/admin/rerank": (body) => ({ ...off, ...(body as object), revision: 2 }) }));
    renderApp("/admin/reranking");
    const select = await screen.findByRole("combobox", { name: /Rerank model/ }, { timeout: 4000 });
    await waitFor(() => expect(within(select).getByRole("option", { name: /· Healthy$/ })).toBeInTheDocument());
    await userEvent.selectOptions(select, "r1");
    const candidates = screen.getByRole("textbox", { name: /Candidates/ });
    await userEvent.clear(candidates);
    await userEvent.type(candidates, "60");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Enter a whole number from 5 to 50.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    await userEvent.clear(candidates);
    await userEvent.type(candidates, "30");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ modelId: "r1", candidates: 30, timeLimitMs: 2000 }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the status with the model's health and the agents that turned reranking off, and compares a search", async () => {
    const on = { ...off, modelId: "r1", agents: 4, agentsOff: [{ agentId: "a9", name: "Plain helper", teamSlug: "registrar", teamName: "Office of the Registrar" }] };
    const hit = (n: number, rerankScore?: number) => ({ chunkId: `c${n}`, documentId: "d", sourceId: "s", content: `Passage ${n}`, headingPath: [], title: `Page ${n}`, filename: "", url: "", score: 0.03, rerankScore });
    const calls = mockApi(
      routes({
        "GET /v1/admin/rerank": () => on,
        "GET /v1/admin/health-checks": () => [healthy],
        "GET /v1/teams/registrar/kbs": () => [{ id: "k1", name: "Registrar help" }],
        "POST /v1/teams/registrar/kbs/k1/retrieve": (body) =>
          (body as { rerank?: boolean }).rerank === false
            ? { latencyMs: 20, hits: [hit(1), hit(2)] }
            : { latencyMs: 90, rerank: { status: "ok", candidates: 40, latencyMs: 60 }, hits: [hit(2, 0.97), hit(1, 0.2)] },
      }),
    );
    const { container } = renderApp("/admin/reranking");
    const status = (await screen.findByRole("heading", { name: "Status" }, { timeout: 4000 })).closest("section")!;
    expect(within(status).getByText("On")).toBeInTheDocument();
    expect(within(status).getByRole("link", { name: "BGE reranker" })).toHaveAttribute("href", "/admin/models?record=r1");
    expect(await within(status).findByText("Healthy")).toBeInTheDocument();
    expect(within(status).getByText("4 published agents rerank.")).toBeInTheDocument();
    expect(within(status).getByRole("link", { name: "Plain helper" })).toHaveAttribute("href", "/admin/agents?record=a9");
    await userEvent.type(screen.getByRole("textbox", { name: "Question" }), "transcript fee");
    await waitFor(() => expect(screen.getByRole("button", { name: "Compare" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByText("Reranked the best 40 passages in 60 ms.")).toBeInTheDocument();
    const after = screen.getByRole("list", { name: "Reranked" });
    expect(within(after).getAllByRole("listitem")[0]).toHaveTextContent("#1 Page 2");
    expect(within(after).getAllByRole("listitem")[0]).toHaveTextContent("Rerank 0.970 · was #2");
    expect(within(screen.getByRole("list", { name: "Usual order" })).getAllByRole("listitem")[0]).toHaveTextContent("#1 Page 1");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual(
      expect.arrayContaining([{ query: "transcript fee", rerank: false }, { query: "transcript fee" }]),
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows auditors everything read-only, with the reason", async () => {
    mockApi(routes({ "GET /v1/admin/models": () => [] }, "platform_auditor"));
    const { container } = renderApp("/admin/reranking");
    expect(await screen.findByText(/Only platform admins can change reranking/, undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Rerank model/ })).toBeDisabled();
    const guide = screen.getByRole("heading", { name: "Set up reranking" }).closest("section")!;
    expect(within(guide).queryByRole("link", { name: "Add model" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is in the sidebar's Models group, and the Models page opens Add model with kind Rerank", async () => {
    mockApi(routes({ "GET /v1/admin/catalog-usage": () => ({ models: [], profiles: [] }) }));
    renderApp("/admin/models?form=new&kind=rerank");
    expect(await screen.findByRole("link", { name: "Reranking" }, { timeout: 4000 })).toHaveAttribute("href", "/admin/reranking");
    expect(await screen.findByRole("combobox", { name: "Kind" })).toHaveValue("rerank");
  });

  it("works out the steps, the warnings and the Overview row", () => {
    expect(rerankSteps({ connections: 0, rerankModels: 0, chosen: false, isAdmin: true }).map((s) => s.done)).toEqual([false, false, false]);
    expect(rerankSteps({ connections: 2, rerankModels: 1, chosen: true, isAdmin: true }).map((s) => s.done)).toEqual([true, true, true]);
    expect(rerankProblems("4", "200")).toEqual({ candidates: "Enter a whole number from 5 to 50." });
    const model = reranker as Schemas["Model"];
    expect(unhealthyReason({ ...model, enabled: false })).toMatch(/is disabled/);
    expect(unhealthyReason(model, { ...healthy, status: "failing" } as Schemas["HealthCheck"])).toBe("BGE reranker failed its last test.");
    expect(unhealthyReason(model, healthy as Schemas["HealthCheck"])).toBeUndefined();
    expect(offReason({ ...off, modelId: "r1" }, model, { ...conn, enabled: false } as Schemas["Connection"])).toMatch(/connection, Gateway, is disabled/);
    expect(rerankOutcome(undefined)).toMatch(/reranking is off/);
    expect(rerankOutcome({ status: "timeout", candidates: 40, latencyMs: 2000 })).toMatch(/longer than the time limit/);
    expect(rerankFeature(off)).toMatchObject({ state: { label: "Off" }, action: "Set up" });
    expect(rerankFeature({ ...off, modelId: "r1", agents: 1 }, { displayName: "BGE reranker", enabled: true })).toMatchObject({
      state: { label: "On · BGE reranker" },
      description: "Searches rerank their best 40 passages; 1 published agent reranks.",
    });
  });
});
