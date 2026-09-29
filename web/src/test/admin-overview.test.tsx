/* Admin → Overview (A1): the attention queue, the platform at a glance, the setup checklist and recent changes. */
import { screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { weekDelta } from "../pages/admin/overview/glance";
import { setupSteps } from "../pages/admin/overview/setup";
import { type Handler, mockApi, renderApp, shellRoutes } from "./harness";
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
  ...extra,
});

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
