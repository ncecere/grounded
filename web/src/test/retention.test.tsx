/* Admin → Retention and Admin → Legal holds (docs/phase5-deploy.md §5 P3), with axe; the pure helpers. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { holdProblems } from "../pages/admin/retention/hold-dialogs";
import { changedPeriods, formOf, periodError, periodText, rangeText, shortened } from "../pages/admin/retention/labels";
import { mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

type Period = Schemas["RetentionPeriod"];
const period = (kind: Period["kind"], over: Partial<Period> = {}): Period => ({
  kind,
  days: null,
  source: "environment",
  platformSet: false,
  platformDays: null,
  environmentDays: null,
  minDays: kind === "usage_events" ? 7 : kind === "audit_log" ? 30 : 1,
  maxDays: 36500,
  ...over,
});
const periods: Period[] = [
  period("deleted_conversations"),
  period("access_log", { days: 365, source: "platform", platformSet: true, platformDays: 365 }),
  period("analytics_events"),
  period("usage_events"),
  period("audit_log", { days: 2555, environmentDays: 2555 }),
  period("deleted_files"),
  period("expired_invites"),
];
const settings = (revision = 3): Schemas["RetentionSettings"] => ({
  periods,
  levels: [
    { key: "open", name: "Open", rank: 0, conversationRetentionDays: null, anonymousRetentionHours: 24 },
    { key: "sensitive", name: "Sensitive", rank: 1, conversationRetentionDays: 90, anonymousRetentionHours: 48 },
  ],
  updatedAt: "2026-09-27T09:00:00Z",
  updatedBy: null,
  revision,
});
const report: Schemas["RetentionReport"] = {
  generatedAt: "2026-09-27T10:00:00Z",
  kinds: [
    {
      kind: "conversations",
      kept: false,
      due: 12,
      held: 3,
      groups: [
        { teamId: "t1", teamName: "Office of the Registrar", level: { key: "sensitive", name: "Sensitive" }, audience: "signed_in", reason: "retention", due: 10, held: 3 },
        { teamId: "t1", teamName: "Office of the Registrar", level: { key: "open", name: "Open" }, audience: "anonymous", reason: "retention", due: 2, held: 0 },
      ],
    },
    { kind: "deleted_conversations", kept: true, due: 0, held: 0, groups: [] },
    { kind: "access_log", kept: false, due: 40, held: 0, groups: [{ teamId: "t1", teamName: "Office of the Registrar", level: null, audience: "ui", reason: "retention", due: 40, held: 0 }] },
  ],
};
const run: Schemas["RetentionRun"] = {
  id: 7,
  trigger: "schedule",
  requestedBy: null,
  kinds: [],
  status: "ok",
  results: [
    { kind: "conversations", deleted: 5, held: 3, kept: false, error: "" },
    { kind: "audit_log", deleted: 0, held: 0, kept: true, error: "" },
  ],
  error: "",
  createdAt: "2026-09-27T09:50:00Z",
  startedAt: "2026-09-27T09:50:00Z",
  finishedAt: "2026-09-27T09:50:02Z",
};
const hold: Schemas["LegalHold"] = {
  id: "h1",
  scopeType: "user",
  scopeId: "u7",
  scopeLabel: "Sam Student",
  scopeExists: true,
  scopeContext: "",
  reason: "Records request 2026-14",
  coversFrom: "2026-01-01",
  coversTo: null,
  status: "active",
  createdAt: "2026-09-20T09:00:00Z",
  createdBy: { id: "u9", displayName: "Pat Admin", email: "pat@example.edu" },
  releasedAt: null,
  releasedBy: null,
  releaseReason: "",
  conversations: 4,
  deletedConversations: 1,
};

describe("Admin → Retention", () => {
  it("shows periods and where they come from, and saves a shorter one after a confirmation, with If-Match", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/retention": () => settings(),
      "PUT /v1/admin/retention": () => settings(4),
      "GET /v1/admin/retention/report": () => report,
    });
    const { container } = renderApp("/admin/retention");
    expect(await screen.findByText("Confirm periods with your records management first")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Conversation retention by level" })).toHaveTextContent("Delete after 90 days");
    expect(screen.getByText(/Delete after 2555 days/, { selector: "p" })).toHaveTextContent("Environment default");
    expect(await axe(container)).toHaveNoViolations();

    const select = screen.getByRole("combobox", { name: "Audit log: retention" });
    await userEvent.selectOptions(select, "days");
    const days = screen.getByRole("textbox", { name: "Audit log: days" });
    await userEvent.type(days, "10");
    await userEvent.click(screen.getByRole("button", { name: "Save periods" }));
    expect(await screen.findByText("From 30 to 36500 days.")).toBeInTheDocument();
    await userEvent.clear(days);
    await userEvent.type(days, "400");
    await userEvent.click(screen.getByRole("button", { name: "Save periods" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete more data?" });
    expect(within(dialog).getByText("Audit log")).toBeInTheDocument();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save periods" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"3"');
    expect(put.body).toEqual({ periods: [{ kind: "audit_log", mode: "days", days: 400 }] });
  });

  it("shows the dry run with a breakdown per team, level and audience", async () => {
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/admin/retention": () => settings(), "GET /v1/admin/retention/report": () => report });
    const { container } = renderApp("/admin/retention?tab=report");
    const table = await screen.findByRole("table", { name: /What retention would delete now/ });
    const row = await within(table).findByRole("row", { name: /Conversations Per classification level/ });
    expect(row).toHaveTextContent("12");
    expect(within(table).getByText("Kept (no period)")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(row).getByText("Conversations"));
    const sheet = await screen.findByRole("region", { name: "Conversations" });
    const breakdown = within(sheet).getByRole("table", { name: "Breakdown by team, level and audience" });
    expect(within(breakdown).getAllByRole("row")).toHaveLength(3);
    expect(breakdown).toHaveTextContent("Signed-in");
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
  });

  it("lists runs and runs now after a confirmation; auditors can't run it", async () => {
    const queued: Schemas["RetentionRun"] = { ...run, id: 8, trigger: "manual", status: "queued", results: [], requestedBy: { id: "u1", displayName: "Una User", email: "una@example.edu" } };
    let runs = [run];
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/retention": () => settings(),
      "GET /v1/admin/retention/report": () => report,
      "GET /v1/admin/retention/runs": () => runs,
      "POST /v1/admin/retention/runs": () => ((runs = [queued, run]), queued),
    });
    const { container } = renderApp("/admin/retention?tab=runs");
    const table = await screen.findByRole("table", { name: /Retention runs/ });
    expect(await within(table).findByText("Scheduled")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Run now" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Run retention now?" });
    expect(await within(dialog).findByText("Access log: 40")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(await screen.findByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Run now by Una User")).toBeInTheDocument();
  });

  it("is read-only for auditors", async () => {
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/admin/retention": () => settings(), "GET /v1/admin/retention/runs": () => [run] });
    renderApp("/admin/retention");
    expect(await screen.findByRole("combobox", { name: "Audit log: retention" })).toBeDisabled();
  });
});

describe("Admin → Legal holds", () => {
  it("lists holds, shows what a hold keeps (including conversations users deleted) and releases one with a reason", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/legal-holds": () => [hold],
      "GET /v1/admin/legal-holds/h1": () => hold,
      "POST /v1/admin/legal-holds/h1/release": (b) => ({ ...hold, status: "released", releaseReason: (b as { reason: string }).reason }),
    });
    const { container } = renderApp("/admin/legal-holds");
    const table = await screen.findByRole("table", { name: /Legal holds/ });
    expect(await within(table).findByText("1 deleted by users")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(table).getByText("Sam Student"));
    const sheet = await screen.findByRole("region", { name: "Hold on Sam Student" });
    expect(await within(sheet).findByText("1 deleted by their users, kept by this hold")).toBeInTheDocument();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    await userEvent.click(within(sheet).getByRole("button", { name: "Release hold" }));
    const dialog = await screen.findByRole("dialog", { name: "Release the hold on Sam Student?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Release hold" }));
    expect(await within(dialog).findByText("Give the reason for releasing the hold.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Why release it" }), "Request fulfilled");
    await userEvent.click(within(dialog).getByRole("button", { name: "Release hold" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ reason: "Request fulfilled" }));
  });

  it("places a hold", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/legal-holds": () => [],
      "POST /v1/admin/legal-holds": () => ({ ...hold, scopeType: "team", scopeLabel: "Office of the Registrar" }),
    });
    const { container } = renderApp("/admin/legal-holds");
    expect(await screen.findByText("No legal holds.")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Place a hold" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Place a legal hold" });
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Place hold" }));
    expect(within(dialog).getByText("Say what the hold covers.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Team slug or ID" }), "registrar");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Litigation hold, matter 14");
    await userEvent.click(within(dialog).getByRole("button", { name: "Place hold" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({ scopeType: "team", scope: "registrar", reason: "Litigation hold, matter 14", coversFrom: null, coversTo: null }),
    );
  });

  it("offers no changes to auditors", async () => {
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/admin/legal-holds": () => [hold], "GET /v1/admin/legal-holds/h1": () => hold });
    renderApp("/admin/legal-holds?record=h1");
    const sheet = await screen.findByRole("region", { name: "Hold on Sam Student" });
    await within(sheet).findByText("Records request 2026-14");
    expect(screen.queryByRole("button", { name: "Place a hold" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Release hold" })).toBeNull();
  });
});

describe("retention helpers", () => {
  it("describes periods and computes changes and what gets shorter", () => {
    expect(periodText(null)).toBe("Keep");
    expect(periodText(0)).toBe("Delete at the next run");
    expect(periodText(1)).toBe("Delete after 1 day");
    const forms = Object.fromEntries(periods.map((p) => [p.kind, formOf(p)]));
    expect(forms.access_log).toEqual({ mode: "days", days: "365" });
    expect(changedPeriods(periods, forms)).toEqual([]);
    forms.access_log = { mode: "keep", days: "" };
    forms.usage_events = { mode: "days", days: "30" };
    expect(changedPeriods(periods, forms)).toEqual([
      { kind: "access_log", mode: "keep" },
      { kind: "usage_events", mode: "days", days: 30 },
    ]);
    expect(shortened(periods, forms).map((p) => p.kind)).toEqual(["usage_events"]);
    expect(periodError(periods[3]!, { mode: "days", days: "3" })).toBe("From 7 to 36500 days.");
    expect(periodError(periods[3]!, { mode: "days", days: "" })).toBe("Enter a number of days.");
  });

  it("describes date ranges and checks the hold form", () => {
    const id = (d: string) => d;
    expect(rangeText(null, null, id)).toBe("All dates");
    expect(rangeText("2026-01-01", null, id)).toBe("From 2026-01-01");
    expect(rangeText("2026-01-01", "2026-03-31", id)).toBe("2026-01-01 to 2026-03-31");
    expect(holdProblems({ scopeType: "team", scope: " ", reason: "", from: "2026-02-01", to: "2026-01-01" })).toEqual({
      scope: "Say what the hold covers.",
      reason: "Give the reason for the hold, such as the matter or request it's for.",
      to: "The last day must be on or after the first.",
    });
  });
});
