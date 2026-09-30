/* Stored health (E11): "Healthy · 3 minutes ago" on the connections and models lists, the details on record pages, Test refreshing it, and Needs attention. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { failingCount } from "../pages/admin/models/health";
import { type Handler, mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const conn = (id: string, name: string) => ({
  id,
  name,
  description: "",
  baseUrl: `https://${id}.example.edu/v1`,
  hasApiKey: true,
  apiKeyHint: "abcd",
  timeoutSeconds: 60,
  requestsPerMinute: null,
  maxConcurrentRequests: 8,
  enabled: true,
  modelCount: 0,
  revision: 1,
  createdAt: "",
  updatedAt: "",
});
const model = (id: string, name: string) => ({
  id,
  connectionId: "c1",
  key: id,
  upstreamModel: `${id}-upstream`,
  displayName: name,
  description: "",
  kind: "chat",
  maxClassification: "open",
  enabled: true,
  supportsTools: false,
  supportsVision: false,
  compat: {},
  revision: 1,
  createdAt: "",
  updatedAt: ago(60),
});

type Check = Schemas["HealthCheck"];
const check = (subjectKind: Check["subjectKind"], subjectId: string, over: Partial<Check> = {}): Check => ({
  subjectKind,
  subjectId,
  subjectName: subjectId,
  subjectEnabled: true,
  status: "healthy",
  latencyMs: 42,
  message: "",
  trigger: "scheduled",
  checkedAt: ago(3),
  statusSince: ago(600),
  ...over,
});
const failing = (subjectKind: Check["subjectKind"], subjectId: string, over: Partial<Check> = {}) =>
  check(subjectKind, subjectId, { status: "failing", errorClass: "auth", httpStatus: 401, message: "Incorrect API key provided: [redacted]", statusSince: ago(120), ...over });

const catalogRoutes = (checks: () => Check[], extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes("platform_admin"),
  "GET /v1/admin/connections": () => [conn("c1", "Campus gateway"), conn("c2", "Research gateway"), conn("c3", "New gateway")],
  "GET /v1/admin/models": () => [model("m1", "Chat large"), model("m2", "Chat small")],
  "GET /v1/admin/catalog-usage": () => ({ models: [], profiles: [] }),
  "GET /v1/admin/health-checks": () => checks(),
  ...extra,
});

/** The Health cell of a list row. */
const healthCell = (table: HTMLElement, name: string) => {
  const row = within(table).getByRole("rowheader", { name: new RegExp(name) }).closest("tr")!;
  const header = within(table).getAllByRole("columnheader").findIndex((h) => h.textContent?.includes("Health"));
  return row.querySelectorAll("td, th")[header] as HTMLElement;
};

describe("stored health", () => {
  it("shows each connection's health, relatively, and filters the failing ones", async () => {
    const checks = [check("connection", "c1"), failing("connection", "c2")];
    mockApi(catalogRoutes(() => checks));
    const { container } = renderApp("/admin/connections");
    const table = await screen.findByRole("table", { name: "Connections" }, { timeout: 4000 });
    await waitFor(() => expect(healthCell(table, "Campus gateway")).toHaveTextContent("Healthy3 minutes ago"));
    expect(healthCell(table, "Research gateway")).toHaveTextContent("Failingsince 2 hours ago");
    expect(healthCell(table, "New gateway")).toHaveTextContent("Not tested yet");
    // Lists use relative times with the full date on hover.
    expect(healthCell(table, "Campus gateway").querySelector("time")?.getAttribute("title")).toMatch(/\d{4}/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens with ?health=failing (where Needs attention links) showing only failing connections", async () => {
    mockApi(catalogRoutes(() => [check("connection", "c1"), failing("connection", "c2")]));
    renderApp("/admin/connections?health=failing");
    const table = await screen.findByRole("table", { name: "Connections" }, { timeout: 4000 });
    await waitFor(() => expect(within(table).queryByText("Campus gateway")).not.toBeInTheDocument());
    expect(within(table).getByText("Research gateway")).toBeInTheDocument();
    expect(within(table).queryByText("New gateway")).not.toBeInTheDocument();
  });

  it("shows a failing connection's record with the absolute time, the error class and the message", async () => {
    mockApi(catalogRoutes(() => [failing("connection", "c2", { trigger: "manual", triggeredByName: "Dev Admin" })]));
    const { container } = renderApp("/admin/connections?record=c2");
    const sheet = await screen.findByRole("region", { name: "Research gateway" }, { timeout: 4000 });
    expect(await within(sheet).findByText("API key refused (HTTP 401)")).toBeInTheDocument();
    expect(within(sheet).getByText("Incorrect API key provided: [redacted]")).toBeInTheDocument();
    expect(within(sheet).getByText(/by Dev Admin/)).toBeInTheDocument();
    // Record pages show absolute dates.
    const since = within(sheet).getByText(/^since/).querySelector("time")!;
    expect(since).toHaveTextContent(/\d{4}/);
    expect(since).not.toHaveTextContent(/ago/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says a model hasn't been tested yet, and Test model refreshes its health", async () => {
    let checks: Check[] = [];
    const calls = mockApi(
      catalogRoutes(() => checks, {
        "POST /v1/admin/models/m1/test": () => {
          checks = [check("model", "m1", { trigger: "manual", checkedAt: ago(0), latencyMs: 120, triggeredByName: "Dev Admin" })];
          return { ok: true, latencyMs: 120, reply: "pong" };
        },
      }),
    );
    renderApp("/admin/models?record=m1");
    const sheet = await screen.findByRole("region", { name: "Chat large" }, { timeout: 4000 });
    expect(await within(sheet).findByText("Not tested yet")).toBeInTheDocument();
    const reads = () => calls.filter((c) => c.url === "/v1/admin/health-checks").length;
    const before = reads();
    await userEvent.click(within(sheet).getByRole("button", { name: "Test model" }));
    expect(await within(sheet).findByText("Answered in 120 ms")).toBeInTheDocument();
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
    expect(await within(sheet).findByText(/by Dev Admin \(120 ms\)/)).toBeInTheDocument();
    expect(within(sheet).queryByText("Not tested yet")).not.toBeInTheDocument();
  });

  it("shows models' health on the list", async () => {
    mockApi(catalogRoutes(() => [failing("model", "m2", { errorClass: "not_found", httpStatus: undefined })]));
    renderApp("/admin/models");
    const table = await screen.findByRole("table", { name: "Models" }, { timeout: 4000 });
    await waitFor(() => expect(healthCell(table, "Chat small")).toHaveTextContent("Failingsince 2 hours ago"));
    expect(healthCell(table, "Chat large")).toHaveTextContent("Not tested yet");
  });

  it("counts only enabled failing subjects", () => {
    const list = [failing("connection", "c1"), failing("connection", "c2", { subjectEnabled: false }), check("connection", "c3"), failing("model", "m1")];
    expect(failingCount(list, "connection")).toBe(1);
    expect(failingCount(list, "model")).toBe(1);
    expect(failingCount(undefined, "model")).toBe(0);
  });
});

describe("Needs attention", () => {
  const overviewRoutes = (checks: Check[]): Record<string, Handler> => ({
    ...shellRoutes("platform_admin"),
    "GET /v1/admin/overview": () => ({
      teams: { active: 1, archived: 0 },
      users: { total: 1, suspended: 0, signedInLast7Days: 1, platformAdmins: 1 },
      content: { documents: 0, failedDocuments: 0, passages: 0, storageBytes: 0, sharedSources: 0 },
      failedIngest: [],
      teamsNearLimits: [],
      warnings: [],
    }),
    "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0 }),
    "GET /v1/admin/agents": () => [],
    "GET /v1/admin/settings/public-access": () => ({ publicAgentsEnabled: true, revision: 1, updatedAt: "", captcha: { provider: "none" }, anonSessionTtlSeconds: 86400 }),
    "GET /v1/admin/moderation/policies/public": () => ({ audience: "public", modelId: "m9" }),
    "GET /v1/admin/connections": () => [],
    "GET /v1/admin/models": () => [],
    "GET /v1/admin/embedding-profiles": () => [],
    "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
    "GET /v1/admin/analytics": () => ({ daily: [] }),
    "GET /v1/admin/audit": () => ({ items: [], nextCursor: null }),
    "GET /v1/admin/health-checks": () => checks,
  });

  it("says how many connections and models are failing, linking to the filtered lists", async () => {
    mockApi(overviewRoutes([failing("connection", "c1"), failing("connection", "c2", { subjectEnabled: false }), failing("model", "m1"), failing("model", "m2"), check("model", "m3"), failing("mcp_server", "s1")]));
    const { container } = renderApp("/admin");
    const queue = (await screen.findByText("Needs attention")).closest("section")!;
    expect(await within(queue).findByText("1 connection is failing")).toBeInTheDocument();
    expect(within(queue).getByText("2 models are failing")).toBeInTheDocument();
    // One is "it", several are "they"; and a failing connection may have no models, so nothing is claimed about them.
    expect(within(queue).getByText("Its latest test failed. Models on it may not answer until it works again.")).toBeInTheDocument();
    expect(within(queue).getByText("Their latest tests failed. Agents and knowledge bases that use them may not work.")).toBeInTheDocument();
    // Health doesn't stop agents calling a server's tools: the calls will probably fail.
    expect(within(queue).getByText("Its latest test failed. Agents' calls to its tools will probably fail.")).toBeInTheDocument();
    expect(within(queue).getByRole("link", { name: /View connections/ })).toHaveAttribute("href", "/admin/connections?health=failing");
    expect(within(queue).getByRole("link", { name: /View models/ })).toHaveAttribute("href", "/admin/models?health=failing");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("stays clear when everything enabled is healthy", async () => {
    mockApi(overviewRoutes([check("connection", "c1"), failing("connection", "c2", { subjectEnabled: false })]));
    renderApp("/admin");
    const queue = (await screen.findByText("Needs attention")).closest("section")!;
    expect(await within(queue).findByText("All clear")).toBeInTheDocument();
    expect(within(queue).queryByText(/failing/)).not.toBeInTheDocument();
  });
});
