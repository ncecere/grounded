/*
 * MCP tool calls in Costs (docs/mcp-client.md, "Costs"): Prices lists MCP servers beside models, so an unpriced server
 * is found where the Totals card sends admins; Top spenders' server rows open the server; a server's price per call
 * reads as money and can be removed.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => vi.unstubAllGlobals());

const settings: Schemas["CostSettings"] = {
  mode: "track", currency: "USD", timeZone: "America/New_York", warnPercent: 80, defaultBudget: null, revision: 4, updatedAt: "2026-09-20T10:00:00Z",
};
const zero = "0.000000";
const byKind = { chat: "1.000000", embedding: zero, systemone: zero, moderation: zero, ocr: zero, mcp: zero };
const row = (key: string, label: string, extra: Partial<Schemas["CostReportRow"]> = {}): Schemas["CostReportRow"] => ({
  key, label, deleted: false, spend: "1.000000", byKind, tokens: 0, requests: 7, unpriced: false, ...extra,
});
const report = (groupBy: Schemas["CostReport"]["groupBy"], rows: Schemas["CostReportRow"][]): Schemas["CostReport"] => ({
  from: "2026-09-01", to: "2026-09-02", groupBy, currency: "USD", timeZone: "America/New_York",
  total: { spend: "1.000000", byKind, tokens: 0, requests: 7, unpriced: true }, rows,
});
const reports: Record<string, Schemas["CostReport"]> = {
  day: report("day", [row("2026-09-01", "2026-09-01")]),
  team: report("team", []),
  model: report("model", [row("m1", "Chat large", { modelKind: "chat" }), row("s1", "Service status", { modelKind: "mcp_server", unpriced: true, spend: zero })]),
};
const prices: Schemas["CostPriceList"] = {
  currency: "USD",
  items: [
    { modelId: "m1", modelKey: "chat-large", displayName: "Chat large", kind: "chat", enabled: true, unpriced: false,
      current: [{ unit: "chat_tokens_in", price: "3.000000", effectiveFrom: "2026-09-01" }, { unit: "chat_tokens_out", price: "15.000000", effectiveFrom: "2026-09-01" }] },
    { modelId: "s1", modelKey: "", displayName: "Service status", kind: "mcp_server", enabled: true, unpriced: true, current: [{ unit: "mcp_calls", price: null, effectiveFrom: null }] },
    { modelId: "s2", modelKey: "", displayName: "Weather", kind: "mcp_server", enabled: true, unpriced: false, current: [{ unit: "mcp_calls", price: "0.000100", effectiveFrom: "2026-09-01" }] },
  ],
};
const server = (over: Partial<Schemas["MCPServer"]> = {}): Schemas["MCPServer"] => ({
  id: "s1", name: "Service status", description: "", url: "https://status.example.edu/mcp", hasAuth: false, authValueHint: "", maxClassification: "open",
  timeoutSeconds: 30, enabled: true, toolCount: 1, approvedCount: 1, revision: 3, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z",
  pricePerCall: "0.000100", ...over,
});

const routes = (extra = {}) => ({
  ...shellRoutes("platform_admin"),
  "GET /v1/admin/costs/settings": () => settings,
  "GET /v1/admin/costs/report": (_: unknown, c: { search: URLSearchParams }) => reports[c.search.get("groupBy") ?? "day"],
  "GET /v1/admin/costs/prices": () => prices,
  "GET /v1/admin/mcp-servers": () => [server()],
  "GET /v1/admin/health-checks": () => [],
  "GET /v1/admin/mcp-servers/s1/tools": () => [],
  ...extra,
});

describe("MCP tool calls in Costs", () => {
  it("says models or MCP servers lack a price, and the spend copy names MCP tools", async () => {
    mockApi(routes());
    renderApp("/admin/costs");
    expect(await screen.findByText("Some models or MCP servers have no price. See Prices.", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("SystemOne, moderation and MCP tool calls, priced per request.")).toBeInTheDocument();
    expect(screen.getByText(/Chat, embedding, SystemOne, moderation, OCR and MCP tool spend each day\./)).toBeInTheDocument();
  });

  it("opens an MCP server's record from Top spenders → Models", async () => {
    mockApi(routes());
    renderApp("/admin/costs?top=models");
    const table = await screen.findByRole("table", { name: "Top models" }, { timeout: 5000 });
    expect(within(table).getByRole("link", { name: "Service status" })).toHaveAttribute("href", "/admin/mcp-servers?record=s1");
    expect(within(table).getByRole("link", { name: "Chat large" }).getAttribute("href")).toMatch(/^\/admin\/models\?/);
  });

  it("lists MCP servers on Prices, unpriced ones counted, each opening its record", async () => {
    mockApi(routes());
    const { container } = renderApp("/admin/costs?tab=prices");
    const table = await screen.findByRole("table", { name: "Prices" }, { timeout: 5000 });
    const unpriced = (await within(table).findByRole("rowheader", { name: /Service status/ })).closest("tr")!;
    expect(unpriced).toHaveTextContent("MCP server");
    expect(unpriced).toHaveTextContent("Tool calls:");
    expect(unpriced).toHaveTextContent("Unpriced");
    expect(within(unpriced).getByRole("link", { name: "Service status" })).toHaveAttribute("href", "/admin/mcp-servers?record=s1");
    expect(within(table).getByRole("rowheader", { name: /Weather/ }).closest("tr")).toHaveTextContent("$0.0001per call");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("an MCP server's price per call", () => {
  it("reads as money on the record", async () => {
    mockApi(routes());
    renderApp("/admin/mcp-servers?record=s1");
    const sheet = await screen.findByRole("region", { name: "Service status" }, { timeout: 5000 });
    expect(await within(sheet).findByText("$0.0001 per call")).toBeInTheDocument();
    expect(within(sheet).queryByText("0.000100")).toBeNull();
  });

  it("is removed by emptying the field, and left alone when unchanged", async () => {
    const calls = mockApi(routes({ "PATCH /v1/admin/mcp-servers/s1": () => server({ pricePerCall: undefined, revision: 4 }) }));
    const { container } = renderApp("/admin/mcp-servers?form=s1");
    const form = await screen.findByRole("region", { name: "Edit Service status" }, { timeout: 5000 });
    const price = await within(form).findByRole("textbox", { name: /Price per call \(USD\)/ });
    expect(within(form).getByText(/Empty the field to remove the price/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.clear(price);
    await userEvent.click(within(form).getByRole("button", { name: "Save MCP server" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ pricePerCall: "" }));
  });

  it("isn't sent when the price didn't change", async () => {
    const calls = mockApi(routes({ "PATCH /v1/admin/mcp-servers/s1": () => server({ revision: 4 }) }));
    renderApp("/admin/mcp-servers?form=s1");
    const form = await screen.findByRole("region", { name: "Edit Service status" }, { timeout: 5000 });
    await userEvent.click(await within(form).findByRole("button", { name: "Save MCP server" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).not.toHaveProperty("pricePerCall");
  });
});
