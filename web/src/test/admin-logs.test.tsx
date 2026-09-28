/* Admin → Logs (A3, Q6): server filters in the URL, sign-ins hidden by default, entries in a sheet with a diff, the access log's filters. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { csvField, toCSV } from "../pages/admin/logs/common";
import { mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const entry = (id: number, action: string, extra: Partial<Schemas["AuditEntry"]> = {}): Schemas["AuditEntry"] => ({
  id,
  occurredAt: "2026-09-26T10:00:00Z",
  actorKind: "user",
  actor: { kind: "user", userId: "u2", email: "alex@example.edu", displayName: "Alex" },
  actorUserId: "u2",
  teamId: null,
  action,
  targetType: "model",
  targetId: "m1",
  targetLabel: "GPT-OSS 120B",
  targetExists: true,
  parent: null,
  before: { enabled: true, displayName: "GPT-OSS" },
  after: { enabled: false, displayName: "GPT-OSS 120B" },
  metadata: {},
  requestId: "req-1",
  ...extra,
});

const users = { items: [{ id: "u2", email: "alex@example.edu", displayName: "Alex", platformRole: "none", status: "active", revision: 1, createdAt: "" }], nextCursor: null };

describe("admin logs", () => {
  it("hides sign-ins by default, filters in the URL and opens an entry with its diff", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/users": () => users,
      "GET /v1/admin/audit": () => ({ items: [entry(2, "platform.model_update")], nextCursor: null }),
    });
    const { container, router } = renderApp("/admin/logs?action=platform.");
    const table = await screen.findByRole("table", { name: "Audit log" });
    expect(await within(table).findByText("Changed model")).toBeInTheDocument();
    const first = calls.find((c) => c.url === "/v1/admin/audit")!;
    expect(first.search.get("excludeAction")).toBe("auth.");
    expect(first.search.get("action")).toBe("platform.");
    expect(screen.getByRole("switch", { name: "Hide sign-ins" })).toBeChecked();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("switch", { name: "Hide sign-ins" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ signins: "show" }));
    await waitFor(() =>
      expect(
        calls
          .filter((c) => c.url === "/v1/admin/audit")
          .at(-1)!
          .search.get("excludeAction"),
      ).toBeNull(),
    );

    await userEvent.click(within(table).getByRole("button", { name: /Actions for Changed model/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "View details" }));
    const sheet = await screen.findByRole("region", { name: "Changed model" });
    expect(within(sheet).getByRole("heading", { name: "Changes" })).toBeInTheDocument();
    expect(within(sheet).getByText("req-1")).toBeInTheDocument();
  });

  it("filters the access log by agent and channel", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_auditor"),
      "GET /v1/admin/users": () => users,
      "GET /v1/admin/agents": () => [],
      "GET /v1/admin/access-log": () => ({
        items: [
          {
            id: 1,
            at: "2026-09-26T10:00:00Z",
            userId: "u2",
            userEmail: "blair@example.edu",
            userName: "Blair",
            apiKeyId: null,
            agentId: "ag1",
            agentName: "Registrar assistant",
            agentSlug: "registrar-assistant",
            teamSlug: "registrar",
            agentVersion: 1,
            rank: 1,
            classification: "sensitive",
            channel: "ui",
          },
        ],
        nextCursor: null,
      }),
    });
    const { container } = renderApp("/admin/logs?tab=access&agent=ag1&channel=widget");
    const table = await screen.findByRole("table", { name: "Access log" });
    expect(await within(table).findByRole("link", { name: "Blair" })).toBeInTheDocument();
    expect(within(table).getByText("Chat page")).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/admin/access-log" && c.search.get("channel") === "widget")).toBe(true));
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("quotes CSV fields", () => {
    expect(csvField('a "b", c')).toBe('"a ""b"", c"');
    expect(csvField({ x: 1 })).toBe('"{""x"":1}"');
    expect(toCSV(["a", "b"], [[1, null]])).toBe("a,b\r\n1,\r\n");
  });
});

describe("audit diff names", () => {
  it("names known ids in before/after values and leaves the rest", async () => {
    const { nameIds } = await import("../components/audit/labels");
    const id = "9f3c1a2b-0000-4000-8000-000000000001";
    const names = new Map([[id, "GPT-OSS 120B"]]);
    expect(nameIds({ chatModelId: id.toUpperCase(), kbIds: [id, "x"], temperature: 0.2, other: "b0d98d2e-2577-4045-b342-956980af78ef" }, names)).toEqual({
      chatModelId: "GPT-OSS 120B (9F3C1A2B…)",
      kbIds: ["GPT-OSS 120B (9f3c1a2b…)", "x"],
      temperature: 0.2,
      other: "b0d98d2e-2577-4045-b342-956980af78ef",
    });
  });
});
