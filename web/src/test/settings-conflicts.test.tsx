/*
 * Save conflicts on the pages v0.4.2 added (re-test AD2-01, AD2-02, AD2-08, AD2-17): Admin → Settings, Reranking and
 * Costs → Settings keep what was typed through a 412, list what changed elsewhere in the form's own words (a select's
 * label, not its stored value), and save over it on purpose.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { choiceFormat, serverChanges } from "../components/templates/revision-form";
import { type Handler, meFor, mockApi, renderApp, Reply, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const conflict = () => Reply.error(412, "revision_conflict", "Someone else changed this since you loaded it.");

/** A revisioned record "in another tab": `elsewhere` changes it, a PUT with an old If-Match gets 412. */
function record<T extends { revision: number }>(start: T) {
  let current = start;
  return {
    get: () => current,
    put: (body: unknown, call: { headers: Headers }) => {
      if (call.headers.get("If-Match") !== `"${current.revision}"`) return conflict();
      current = { ...current, ...(body as Partial<T>), revision: current.revision + 1 };
      return current;
    },
    elsewhere: (patch: Partial<T>) => (current = { ...current, ...patch, revision: current.revision + 1 }),
  };
}

const costs: Schemas["CostSettings"] = {
  mode: "enforce", currency: "XYZ", timeZone: "America/New_York", warnPercent: 80, defaultBudget: null, revision: 4, updatedAt: "2026-09-20T10:00:00Z",
};

const settingsRoutes = (r: ReturnType<typeof record<Schemas["CostSettings"]>>): Record<string, Handler> => ({
  ...shellRoutes("platform_admin"),
  "GET /v1/me": () => meFor("platform_admin"),
  "GET /v1/admin/costs/settings": () => r.get(),
  "PUT /v1/admin/costs/settings": (b, call) => r.put(b, call),
  "GET /v1/admin/settings/evaluations": () => ({ enabled: true, revision: 2, updatedAt: "2026-09-01T10:00:00Z" }),
  "GET /v1/admin/settings/mcp": () => ({ enabled: false, oauthEnabled: false, revision: 4, updatedAt: "2026-09-01T10:00:00Z" }),
  "GET /v1/admin/settings/answer-cache": () => ({ enabled: true, revision: 1, updatedAt: "2026-09-01T10:00:00Z" }),
});

describe("Admin → Settings save conflict (AD2-01)", () => {
  it("keeps the typed currency, lists Costs → Settings' change and saves both with Overwrite", async () => {
    const user = userEvent.setup();
    const r = record(costs);
    const calls = mockApi(settingsRoutes(r));
    const { container } = renderApp("/admin/settings");
    const currency = await screen.findByRole("textbox", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "USD");
    r.elsewhere({ warnPercent: 81, mode: "track" });
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    const list = await screen.findByRole("list", { name: "Changed elsewhere" });
    expect(within(list).getByText(/now “81” \(changed on Costs → Settings; your save keeps it\)/)).toBeInTheDocument();
    // The mode reads as the select does ("Track only"), not its value (AD2-17).
    expect(within(list).getByText(/Cost tracking:/).parentElement).toHaveTextContent("now “Track only”");
    expect(screen.getByRole("textbox", { name: "Currency" })).toHaveValue("USD");
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("button", { name: "Overwrite with mine" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    const put = calls.filter((c) => c.method === "PUT")[1]!;
    expect(put.headers.get("If-Match")).toBe('"5"');
    expect(put.body).toMatchObject({ currency: "USD", warnPercent: 81, mode: "track" });
    await waitFor(() => expect(screen.queryByRole("list", { name: "Changed elsewhere" })).toBeNull());
    expect(screen.getByRole("textbox", { name: "Currency" })).toHaveValue("USD");
  });

  it("lists a currency changed elsewhere on Costs → Settings' form, which keeps its own edit (AD2-08)", async () => {
    const user = userEvent.setup();
    const r = record({ ...costs, currency: "USD" });
    const calls = mockApi(settingsRoutes(r));
    renderApp("/admin/costs?tab=settings");
    const threshold = await screen.findByRole("textbox", { name: /Warning threshold/ });
    await user.clear(threshold);
    await user.type(threshold, "90");
    r.elsewhere({ currency: "EUR" });
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    const list = await screen.findByRole("list", { name: "Changed elsewhere" });
    expect(within(list).getByText(/now “EUR” \(changed on Admin → Settings; your save keeps it\)/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Warning threshold/ })).toHaveValue("90");
    await user.click(screen.getByRole("button", { name: "Overwrite with mine" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "PUT")[1]!.body).toMatchObject({ warnPercent: 90, currency: "EUR" });
  });
});

const reranker = {
  id: "r1", connectionId: "c1", key: "bge-reranker", upstreamModel: "bge-reranker-v2-m3", displayName: "BGE reranker", description: "", kind: "rerank",
  maxClassification: "sensitive", enabled: true, supportsTools: false, supportsVision: false, compat: {}, revision: 1, createdAt: "", updatedAt: "",
};
const other = { ...reranker, id: "r2", key: "other", upstreamModel: "other-reranker", displayName: "Other reranker" };
const healthy = (id: string) => ({ subjectKind: "model", subjectId: id, subjectEnabled: true, status: "healthy", checkedAt: "2026-10-01T10:00:00Z", statusSince: "2026-10-01T10:00:00Z", latencyMs: 80, trigger: "manual" });

describe("Reranking settings save conflict (AD2-02)", () => {
  it("keeps the typed candidates, names the other model chosen elsewhere and overwrites on purpose", async () => {
    const user = userEvent.setup();
    const r = record<Schemas["RerankSettings"]>({ modelId: "r1", candidates: 40, timeLimitMs: 2000, agents: 0, agentsOff: [], revision: 1, updatedAt: null });
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => [{ id: "c1", name: "Gateway", baseUrl: "http://gateway.example.edu/v1", enabled: true, modelCount: 2, revision: 1 }],
      "GET /v1/admin/models": () => [reranker, other],
      "GET /v1/admin/health-checks": () => [healthy("r1"), healthy("r2")],
      "GET /v1/admin/rerank": () => r.get(),
      "PUT /v1/admin/rerank": (b, call) => r.put(b, call),
    });
    const { container } = renderApp("/admin/reranking");
    const candidates = await screen.findByRole("textbox", { name: /Candidates/ }, { timeout: 4000 });
    await user.clear(candidates);
    await user.type(candidates, "30");
    r.elsewhere({ modelId: "r2" });
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    const list = await screen.findByRole("list", { name: "Changed elsewhere" });
    expect(list).toHaveTextContent("Rerank model: now “Other reranker” (you didn't change it, so the form shows theirs)");
    expect(screen.getByRole("textbox", { name: /Candidates/ })).toHaveValue("30");
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("button", { name: "Overwrite with mine" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    const put = calls.filter((c) => c.method === "PUT")[1]!;
    expect(put.headers.get("If-Match")).toBe('"2"');
    expect(put.body).toEqual({ modelId: "r2", candidates: 30, timeLimitMs: 2000 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull());
  });
});

describe("the list of changes uses the form's words (AD2-17)", () => {
  it("shows a choice's label and falls back to the value", () => {
    type F = { effort: string; note: string };
    const fmt = choiceFormat<F>({ effort: { off: "Off", high: "High" } });
    const [c] = serverChanges<F>({ effort: "low", note: "" }, { effort: "high", note: "" }, { effort: "off", note: "" }, { effort: "Reasoning effort" }, fmt);
    expect(c).toMatchObject({ label: "Reasoning effort", theirs: "Off", mine: "High", clash: true });
    expect(fmt("note", "x")).toBe("x");
  });
});
