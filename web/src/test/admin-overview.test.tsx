/* Admin → Overview (A1, v0.2.1 I2): the platform at a glance, the attention queue, the Features card with the evaluations switch, the setup checklist and recent changes. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { costFeature, names, systemOneFeature } from "../pages/admin/overview/feature-text";
import { weekDelta } from "../pages/admin/overview/glance";
import { setupSteps } from "../pages/admin/overview/setup";
import { type Handler, meFor, mockApi, renderApp, shellRoutes } from "./harness";
import { adminAgent } from "./admin-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const overview: Schemas["AdminOverview"] = {
  teams: { active: 3, archived: 1 },
  users: { total: 6, suspended: 0, signedInLast7Days: 4, platformAdmins: 1 },
  content: { documents: 120, failedDocuments: 2, passages: 3400, storageBytes: 5_000_000, sharedSources: 2 },
  failedIngest: [{ teamSlug: "registrar", teamName: "Office of the Registrar", failed: 2 }],
  teamsNearLimits: [{ teamSlug: "registrar", teamName: "Office of the Registrar", key: "knowledge_bases", label: "Knowledge bases", unit: "count", used: 9, max: 10 }],
  warnings: [
    { code: "crawl_allowlist_empty", severity: "warning", message: "The crawl allowlist is empty, so no web source can be crawled.", fix: "Add host patterns." },
    { code: "public_agents_without_moderation", severity: "warning", message: "Public agents are turned on, but the public audience has no moderation provider.", fix: "Choose a provider." },
    { code: "smtp_not_configured", severity: "warning", message: "Email notifications are off: SMTP_HOST is not set.", fix: "Set SMTP_HOST." },
    { code: "oidc_no_domain_restriction", severity: "info", message: "Anyone the OIDC provider signs in can use Grounded.", fix: "Set OIDC_ALLOWED_EMAIL_DOMAINS." },
  ],
};

const routes = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes("platform_admin"),
  "GET /v1/admin/overview": () => overview,
  "GET /v1/admin/attention": () => ({ pendingDomainRequests: 2 }),
  "GET /v1/admin/agents": () => [adminAgent("disabled_by_platform"), adminAgent("active", { id: "ag2", name: "Public helper", audience: "public" })],
  "GET /v1/admin/settings/public-access": () => ({ publicAgentsEnabled: true, revision: 1, updatedAt: "", captcha: { provider: "none" }, anonSessionTtlSeconds: 86400 }),
  "GET /v1/admin/moderation/policies/public": () => ({ audience: "public", modelId: null }),
  "GET /v1/admin/connections": () => [],
  "GET /v1/admin/models": () => [],
  "GET /v1/admin/embedding-profiles": () => [],
  "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
  "GET /v1/admin/analytics": () => ({ daily: Array.from({ length: 14 }, (_, i) => ({ date: `2026-09-${10 + i}`, answers: i < 7 ? 10 : 20, conversations: 1 })) }),
  "GET /v1/admin/audit": () => ({
    items: [
      {
        id: 5,
        occurredAt: "2026-09-26T10:00:00Z",
        actorKind: "user",
        actor: { kind: "user", displayName: "Dev Admin" },
        action: "platform.model_update",
        targetType: "model",
        targetId: "m1",
        targetLabel: "GPT",
        targetExists: true,
        metadata: {},
        requestId: "r",
      },
    ],
    nextCursor: null,
  }),
  "GET /v1/admin/settings/evaluations": () => ({ enabled: true, revision: 2, updatedAt: "2026-09-01T10:00:00Z" }),
  "GET /v1/admin/costs/settings": () => ({ mode: "track", currency: "USD", timeZone: "UTC", warnPercent: 80, defaultBudget: null, revision: 1, updatedAt: "" }),
  "GET /v1/admin/parsing": () => ({ ocrEnabled: true, backend: "tesseract", visionModelId: null, languages: "eng", backends: [], maxPagesPerDocument: 50, concurrency: 1, needsOcr: [], revision: 1, updatedAt: null }),
  "GET /v1/admin/group-mapping": () => ({ groupsClaim: "groups", oidcEnabled: true, ruleCount: 3, peopleSeen: 4, peopleWithClaim: 4, recentSignIns: 2 }),
  "GET /v1/admin/systemone": () => ({
    modelId: "s1",
    judging: { enabled: true },
    citations: { enabled: true },
    scope: { enabled: false },
    agents: { judging: 1, citations: 2, scope: 0, any: 2 },
    revision: 1,
    updatedAt: null,
  }),
  // One team enforces its budget while the platform only tracks (a team setting).
  "GET /v1/admin/costs/budgets": () => ({
    month: "2026-09-01",
    currency: "USD",
    items: [
      { teamId: "t1", teamSlug: "registrar", teamName: "Office of the Registrar", modeOverride: "enforce", ownBudget: true, status: { mode: "enforce" }, projected: null },
      { teamId: "t2", teamSlug: "qa", teamName: "QA Team", modeOverride: "inherit", ownBudget: false, status: { mode: "track" }, projected: null },
    ],
  }),
  "GET /v1/admin/settings/maintenance": () => ({ enabled: false, reason: "", plannedEndAt: null, startedAt: null, startedBy: null, updatedBy: null, updatedAt: "", revision: 1 }),
  ...extra,
});

const featureRow = async (name: string) => {
  const card = (await screen.findByRole("heading", { level: 2, name: "Features" })).closest("section")!;
  const title = await within(card).findByText(name, { selector: "[class*=title]" });
  return title.closest<HTMLElement>("[class*=item]")!;
};

describe("admin overview", () => {
  it("lists what needs attention, the platform at a glance, setup and recent changes", async () => {
    const calls = mockApi(routes());
    const { container } = renderApp("/admin");
    const queue = (await screen.findByText("Needs attention")).closest("section")!;
    expect(await within(queue).findByText("2 domain requests waiting for review")).toBeInTheDocument();
    expect(await within(queue).findByText("1 agent is disabled by the platform")).toBeInTheDocument();
    expect(within(queue).getByText("The public audience has no moderation provider")).toBeInTheDocument();
    expect(within(queue).getByText("2 documents failed to index in Office of the Registrar")).toBeInTheDocument();
    // Failed documents lead to Parsing & OCR, where admins retry them or notify the owners (not to the team's page).
    expect(within(queue).getByRole("link", { name: /Failed documents/ })).toHaveAttribute("href", "/admin/parsing#document-problems");
    expect(within(queue).getByText("Office of the Registrar is at 90% of its knowledge bases limit")).toBeInTheDocument();
    // Production-readiness warnings (E7): a link where the fix is in the UI, none for environment settings.
    expect(within(queue).getByText("The crawl allowlist is empty, so no web source can be crawled.")).toBeInTheDocument();
    expect(within(queue).getByRole("link", { name: /Crawl domains/ })).toHaveAttribute("href", "/admin/crawl-domains?tab=allowlist");
    expect(within(queue).getByText("Email notifications are off: SMTP_HOST is not set.")).toBeInTheDocument();
    expect(within(queue).getByText("Set OIDC_ALLOWED_EMAIL_DOMAINS.")).toBeInTheDocument();
    // Said once: the moderation row covers the public-agents warning.
    expect(within(queue).queryByText(/Public agents are turned on/)).not.toBeInTheDocument();
    expect(await screen.findByText("Set up this install")).toBeInTheDocument();
    expect(await screen.findByText(/Changed model: GPT/)).toBeInTheDocument();
    expect(await screen.findByText("140")).toBeInTheDocument(); // answers in the last 7 days
    expect(calls.find((c) => c.url === "/v1/admin/audit")?.search.get("excludeAction")).toBe("auth.");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("puts the platform at a glance first, then attention and features, then the last 5 changes", async () => {
    const calls = mockApi(routes());
    renderApp("/admin");
    const glance = await screen.findByRole("heading", { level: 2, name: "Platform at a glance" });
    const attention = screen.getByRole("heading", { level: 2, name: "Needs attention" });
    const features = screen.getByRole("heading", { level: 2, name: "Features" });
    const recent = screen.getByRole("heading", { level: 2, name: "Recent changes" });
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(glance, attention) && before(attention, features) && before(features, recent)).toBe(true);
    expect(within(recent.closest("section")!).getByRole("link", { name: /All logs/ })).toHaveAttribute("href", "/admin/logs");
    await waitFor(() => expect(calls.find((c) => c.url === "/v1/admin/audit")?.search.get("limit")).toBe("5"));
  });

  it("links a team near its budget to the team's Overview, where the Budget card is (I7)", async () => {
    const near = { teamSlug: "registrar", teamName: "Office of the Registrar", state: "warning" as const, percent: 85, spent: "85.000000", limit: "100.000000", currency: "USD" };
    mockApi(routes({ "GET /v1/admin/overview": () => ({ ...overview, teamsNearBudget: [near] }) }));
    renderApp("/admin");
    const queue = (await screen.findByText("Needs attention")).closest("section")!;
    expect(await within(queue).findByText("Office of the Registrar is at 85% of its monthly budget")).toBeInTheDocument();
    expect(within(queue).getByRole("link", { name: /Team budget/ })).toHaveAttribute("href", "/admin/teams/registrar");
    expect(within(queue).getByRole("link", { name: /Team limits/ })).toHaveAttribute("href", "/admin/teams/registrar?tab=limits");
  });

  it("lists the optional features with their state and where each is set up", async () => {
    mockApi(routes());
    const { container } = renderApp("/admin");
    const costs = await featureRow("Cost tracking");
    // The teams that enforce anyway, by name: "Nothing is refused" would be wrong.
    expect(await within(costs).findByText("Track only · 1 team enforced")).toBeInTheDocument();
    expect(within(costs).getByText(/^Enforced for Office of the Registrar \(a team setting\)/)).toBeInTheDocument();
    expect(within(costs).queryByText(/Nothing is refused/)).toBeNull();
    expect(within(costs).getByRole("link", { name: /Cost settings/ })).toHaveAttribute("href", "/admin/costs?tab=settings");
    const ocr = await featureRow("OCR");
    expect(await within(ocr).findByText("On · Tesseract")).toBeInTheDocument();
    expect(within(ocr).getByRole("link", { name: /Parsing & OCR/ })).toHaveAttribute("href", "/admin/parsing");
    const sso = await featureRow("SSO groups");
    expect(await within(sso).findByText("3 rules")).toBeInTheDocument();
    expect(within(sso).getByRole("link", { name: /SSO groups/ })).toHaveAttribute("href", "/admin/group-mapping");
    const systemOne = await featureRow("SystemOne");
    // What agents use, not only the platform defaults.
    expect(await within(systemOne).findByText("Configured · checks on 2 agents")).toBeInTheDocument();
    expect(within(systemOne).getByText("Published agents use citation checks on 2 agents and passage judging on 1 agent, by their own setting or the platform default.")).toBeInTheDocument();
    expect(within(systemOne).getByRole("link", { name: /SystemOne/ })).toHaveAttribute("href", "/admin/systemone");
    const pub = await featureRow("Public access");
    expect(await within(pub).findByText("On")).toBeInTheDocument();
    expect(within(pub).getByRole("link", { name: /Public access/ })).toHaveAttribute("href", "/admin/public-access");
    const maintenance = await featureRow("Maintenance");
    expect(await within(maintenance).findByText("Off")).toBeInTheDocument();
    expect(within(maintenance).getByRole("link", { name: /Maintenance/ })).toHaveAttribute("href", "/admin/maintenance");
    // Evaluations: a state badge, the switch and a link to its limits; its whole description, not clamped.
    const evals = await featureRow("Evaluations");
    expect(await within(evals).findByText("On")).toBeInTheDocument();
    expect(within(evals).getByRole("link", { name: /Evaluation limits/ })).toHaveAttribute("href", "/admin/limits?tab=evaluations");
    expect(within(evals).getByText(/Members never see them\.$/).className).toMatch(/fullText/);
    // The #features link lands below the sticky top bar.
    expect(screen.getByRole("heading", { level: 2, name: "Features" }).closest("section")!.className).toMatch(/features/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("turns evaluations off for the platform from the Features card, with If-Match", async () => {
    const calls = mockApi(routes({ "PUT /v1/admin/settings/evaluations": (b) => ({ ...(b as object), revision: 3, updatedAt: "2026-09-28T10:00:00Z" }) }));
    renderApp("/admin");
    const row = await featureRow("Evaluations");
    const toggle = await within(row).findByRole("switch", { name: "Allow evaluations" });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    // A confirmation first, saying what disappears; nothing is saved until it's confirmed.
    const confirm = await screen.findByRole("alertdialog", { name: "Turn evaluations off for every team?" });
    expect(within(confirm).getByText(/Evaluations tabs and pages disappear/)).toBeInTheDocument();
    expect(await axe(confirm)).toHaveNoViolations();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    await userEvent.click(within(confirm).getByRole("button", { name: "Turn evaluations off" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({ enabled: false });
    expect(put.headers.get("If-Match")).toBe('"2"');
    expect(await within(row).findByText(/Sets and runs are kept/)).toBeInTheDocument();
    expect(await within(row).findByText("Off")).toBeInTheDocument();
  });

  it("shows auditors each feature's state, and the switch disabled with the reason", async () => {
    mockApi(routes({ "GET /v1/me": () => meFor("platform_auditor"), "GET /v1/admin/costs/settings": () => ({ mode: "off", currency: "USD", timeZone: "UTC", warnPercent: 80, defaultBudget: null, revision: 1, updatedAt: "" }) }));
    renderApp("/admin");
    const row = await featureRow("Evaluations");
    expect(await within(row).findByText("On")).toBeInTheDocument();
    const toggle = within(row).getByRole("switch", { name: "Allow evaluations" });
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveAccessibleDescription("Only platform admins can turn this on or off.");
    // Read-only staff open the requests; they don't review them.
    const queue = (await screen.findByText("Needs attention")).closest("section")!;
    expect(await within(queue).findByRole("link", { name: /View requests/ })).toBeInTheDocument();
    expect(await within(await featureRow("Cost tracking")).findByText("Off · 1 team enforced")).toBeInTheDocument();
  });

  it("says which teams override the platform's cost mode, and which checks agents use", () => {
    expect(names(["A"])).toBe("A");
    expect(names(["A", "B"])).toBe("A and B");
    expect(names(["A", "B", "C"])).toBe("A, B and C");
    expect(names(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
    const team = (teamName: string, mode: "off" | "track" | "enforce") => ({ teamName, status: { mode } as Schemas["TeamBudgetState"] });
    expect(costFeature("track", [team("A", "track")]).state.label).toBe("Track only");
    expect(costFeature("enforce", [team("A", "enforce"), team("B", "track")])).toMatchObject({
      state: { label: "Enforce · 1 team not enforced" },
      description: expect.stringContaining("Not enforced for B (a team setting)."),
    });
    expect(costFeature("track", [team("A", "enforce"), team("B", "enforce")]).state.label).toBe("Track only · 2 teams enforced");
    expect(systemOneFeature({ modelId: null, agents: { judging: 0, citations: 0, scope: 0, any: 0 } }).state.label).toBe("Not configured");
    expect(systemOneFeature({ modelId: "m", agents: { judging: 0, citations: 0, scope: 0, any: 0 } }).description).toMatch(/no published agent uses/);
    expect(systemOneFeature({ modelId: "m", agents: { judging: 0, citations: 0, scope: 1, any: 1 } }).state.label).toBe("Configured · checks on 1 agent");
  });

  it("computes the setup steps and the weekly change", () => {
    const steps = setupSteps({
      connections: 1,
      chatModels: [{ maxClassification: "sensitive" }],
      profiles: [{ status: "active", isDefault: true }],
      levels: [
        { key: "open", rank: 0, name: "Open" },
        { key: "sensitive", rank: 1, name: "Sensitive" },
        { key: "restricted", rank: 2, name: "Restricted" },
      ],
      publicModeration: false,
      teams: 2,
    });
    expect(steps.map((s) => [s.id, s.done])).toEqual([
      ["connection", true],
      ["models", true],
      ["profile", true],
      ["classifications", false],
      ["moderation", false],
      ["team", true],
    ]);
    expect(steps[3]!.description).toContain("Restricted");
    expect(weekDelta([...Array(7).fill(10), ...Array(7).fill(20)])).toMatchObject({ value: "+100%", trend: "up" });
    expect(weekDelta([1, 2])).toBeUndefined();
  });
});
