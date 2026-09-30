/* Admin catalog (A5): connections and models in record sheets, Used by, and "Add as model" from a connection test. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { slugKey } from "../pages/admin/models/model-dialog";
import { mockApi, renderApp, shellRoutes } from "./harness";
import { webSource } from "./web-harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const connection = {
  id: "c1",
  name: "Campus gateway",
  description: "",
  baseUrl: "https://ai.example.edu/v1",
  hasApiKey: true,
  apiKeyHint: "abcd",
  timeoutSeconds: 60,
  requestsPerMinute: null,
  maxConcurrentRequests: 8,
  enabled: true,
  modelCount: 1,
  revision: 1,
  createdAt: "",
  updatedAt: "",
};
const chat = {
  id: "m1",
  connectionId: "c1",
  key: "gpt-oss",
  upstreamModel: "gpt-oss-120b",
  displayName: "GPT-OSS 120B",
  description: "",
  kind: "chat",
  maxClassification: "sensitive",
  enabled: true,
  supportsTools: true,
  supportsVision: false,
  contextWindow: 128000,
  compat: {},
  revision: 1,
  createdAt: "",
  updatedAt: "2026-09-26T10:00:00Z",
};
const usage = { models: [{ modelId: "m1", publishedAgents: 2, draftAgents: 1, profiles: 0, moderationAudiences: ["public"], systemOne: false }], profiles: [] };

describe("admin catalog", () => {
  it("shows a model's Used by in the list and its sheet, and tests it in place", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => [connection],
      "GET /v1/admin/models": () => [chat],
      "GET /v1/admin/catalog-usage": () => usage,
      "POST /v1/admin/models/m1/test": () => ({ ok: true, latencyMs: 120, reply: "OK", timings: { dnsMs: 4012.4, connectMs: 3.2, tlsMs: 21, firstByteMs: 95, reused: false } }),
    });
    const { container } = renderApp("/admin/models");
    const table = await screen.findByRole("table", { name: "Models" }, { timeout: 4000 });
    expect(await within(table).findByText("2 published agents")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(table).getByRole("button", { name: "Actions for GPT-OSS 120B" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "View details" }));
    const sheet = await screen.findByRole("region", { name: "GPT-OSS 120B" });
    expect(within(sheet).getByText("Public moderation")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /Delete/ })).toBeDisabled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Test model" }));
    expect(await within(sheet).findByText("Answered in 120 ms")).toBeInTheDocument();
    expect(within(sheet).getByText(/DNS 4,012 ms · connect 3.2 ms · TLS 21 ms · first byte 95 ms/)).toHaveTextContent("Name resolution is slow");
    expect(calls.some((c) => c.url === "/v1/admin/models/m1/test")).toBe(true);
  });

  it("tests a connection and adds an offered model with the connection and ID filled in", async () => {
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => [connection],
      "GET /v1/admin/models": () => [chat],
      "POST /v1/admin/connections/c1/test": () => ({ ok: true, latencyMs: 80, probe: "models", models: ["gpt-oss-120b", "openai/qwen3-32b"], timings: { dnsMs: 2, connectMs: 1, tlsMs: 12, firstByteMs: 60, reused: false } }),
    });
    renderApp("/admin/connections?record=c1");
    const sheet = await screen.findByRole("region", { name: "Campus gateway" }, { timeout: 4000 });
    expect(within(sheet).getByText("GPT-OSS 120B")).toBeInTheDocument(); // on this connection
    await userEvent.click(within(sheet).getByRole("button", { name: "Test connection" }));
    const offered = await within(sheet).findByRole("list", { name: "Models offered by the proxy" });
    expect(within(sheet).getByText("DNS 2.0 ms · connect 1.0 ms · TLS 12 ms · first byte 60 ms")).toBeInTheDocument();
    expect(within(offered).getByText("In the catalog")).toBeInTheDocument();
    await userEvent.click(within(offered).getByRole("button", { name: "Add openai/qwen3-32b as a model" }));
    const form = await screen.findByRole("region", { name: "Add model" });
    expect(within(form).getByRole("combobox", { name: /Upstream model ID/ })).toHaveValue("openai/qwen3-32b");
    expect(within(form).getByRole("textbox", { name: /Key/ })).toHaveValue("qwen3-32b");
    await waitFor(() => expect(within(form).getByRole("group", { name: "Chat settings" })).toBeInTheDocument());

    // Pages stack: the form covers the connection, and the breadcrumbs show the path.
    expect(sheet).not.toBeVisible();
    expect(screen.queryByRole("table", { name: "Connections" })).toBeNull();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Connections" })).toBeInTheDocument();
    expect(within(crumbs).getByRole("link", { name: "Campus gateway" })).toBeInTheDocument();
    expect(within(crumbs).getByText("Add model")).toBeInTheDocument();
    expect(within(form).getByRole("link", { name: "Back to Campus gateway" })).toBeInTheDocument();
    // Cancel (untouched) returns to the connection's page, then its back link to the list.
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Add model" })).toBeNull());
    const again = await screen.findByRole("region", { name: "Campus gateway" });
    expect(again).toBeVisible();
    await userEvent.click(within(again).getByRole("link", { name: "Back to Connections" }));
    expect(await screen.findByRole("table", { name: "Connections" })).toBeInTheDocument();
  });

  it("tests a SystemOne service with a SystemOne question and explains a missing model list (J2)", async () => {
    let answer: object = { ok: false, latencyMs: 9, probe: "models", models: [], error: { kind: "not_found", status: 404, message: "not found" } };
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => [{ ...connection, name: "Judge service", modelCount: 0 }],
      "GET /v1/admin/models": () => [],
      "POST /v1/admin/connections/c1/test": () => answer,
    });
    const { container } = renderApp("/admin/connections?record=c1");
    const sheet = await screen.findByRole("region", { name: "Judge service" }, { timeout: 4000 });
    await userEvent.click(within(sheet).getByRole("button", { name: "Test connection" }));
    expect(await within(sheet).findByText(/add its SystemOne model to this connection, then test again/)).toBeInTheDocument();
    answer = { ok: true, latencyMs: 42, probe: "systemone", systemOneModel: "judge-latest", models: [] };
    await userEvent.click(within(sheet).getByRole("button", { name: "Test connection" }));
    expect(await within(sheet).findByText("Connected in 42 ms")).toBeInTheDocument();
    expect(within(sheet).getByText(/The SystemOne service answered a test question/)).toHaveTextContent("(model judge-latest)");
    expect(within(sheet).queryByRole("list", { name: "Models offered by the proxy" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("lists where each shared source is used, by team and knowledge base (A6)", async () => {
    const shared = { ...webSource({ id: "sh1", name: "Academic calendar" }), activeCrawl: null };
    const attach = (kbId: string, kbName: string, teamSlug: string, teamName: string) => ({ sourceId: "sh1", kbId, kbName, teamSlug, teamName, teamMaxClassification: "sensitive" });
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/shared-sources": () => [shared],
      "GET /v1/admin/shared-source-usage": () => [
        attach("k1", "Handbook", "registrar", "Office of the Registrar"),
        attach("k2", "FAQ", "registrar", "Office of the Registrar"),
        attach("k3", "Housing", "housing", "Housing"),
      ],
    });
    const { container } = renderApp("/admin/shared-sources");
    const table = await screen.findByRole("table", { name: "Shared sources" }, { timeout: 4000 });
    expect(await within(table).findByText("2 teams · 3 knowledge bases")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(table).getByRole("button", { name: "Actions for Academic calendar" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Where it's used" }));
    const sheet = await screen.findByRole("region", { name: "Where Academic calendar is used" });
    expect(within(sheet).getByRole("link", { name: "Office of the Registrar" })).toHaveAttribute("href", "/admin/teams/registrar");
    expect(within(sheet).getByText("Handbook")).toBeInTheDocument();
    expect(within(sheet).getAllByText("approved up to Sensitive")).toHaveLength(2);
    expect(within(sheet).getByRole("link", { name: "Open the source" })).toHaveAttribute("href", "/admin/shared-sources/sh1?tab=used-by");
  });

  it("has a Used by tab on the shared source's page (A6)", async () => {
    const shared = { ...webSource({ id: "sh1", name: "Academic calendar" }), activeCrawl: null };
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/models": () => [],
      "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0 }),
      "GET /v1/admin/shared-sources/sh1": () => shared,
      "GET /v1/admin/shared-source-usage": () => [
        { sourceId: "sh1", kbId: "k1", kbName: "Handbook", teamSlug: "registrar", teamName: "Office of the Registrar", teamMaxClassification: "sensitive" },
        { sourceId: "other", kbId: "k9", kbName: "Elsewhere", teamSlug: "housing", teamName: "Housing", teamMaxClassification: "open" },
      ],
    });
    const { container } = renderApp("/admin/shared-sources/sh1?tab=used-by");
    const tab = await screen.findByRole("tab", { name: "Used by", selected: true }, { timeout: 4000 });
    expect(tab).toBeInTheDocument();
    expect(await screen.findByText("1 team · 1 knowledge base")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Office of the Registrar" })).toHaveAttribute("href", "/admin/teams/registrar");
    expect(screen.queryByText("Elsewhere")).toBeNull();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs[tabs.length - 1]).toMatch(/Settings/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("suggests model keys from upstream IDs", () => {
    expect(slugKey("openai/GPT-OSS 120B")).toBe("gpt-oss-120b");
    expect(slugKey("_x")).toBe("x");
  });
});
