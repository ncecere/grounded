/* Costs and budgets (E2): Admin → Costs, a model's Pricing, a team's Budget card, the team's spend and banner, and the budget error text; with axe. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { AuditTarget } from "../components/audit/target";
import { Money } from "../components/money";
import { formatMoney, formatMoneyExact } from "../lib/format";
import { ModelPricingSection } from "../pages/admin/models/pricing";
import { AdminTeamBudgetCard } from "../pages/admin/costs/team-budget-card";
import { chatErrorText } from "../pages/chat/stream";
import { BudgetBanner } from "../pages/team/budget-banner";
import { TeamSpendCard } from "../pages/team/spend";
import { Reply, meFor, mockApi, renderApp, renderBare, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => vi.unstubAllGlobals());

const settings = (mode: Schemas["CostMode"]): Schemas["CostSettings"] => ({
  mode, currency: "USD", timeZone: "America/New_York", warnPercent: 80, defaultBudget: null, revision: 4, updatedAt: "2026-09-20T10:00:00Z",
});

const byKind = (chat: string) => ({ chat, embedding: "0.000000", systemone: "0.000000", moderation: "0.000000", ocr: "0.000000" });

const row = (key: string, label: string, spend: string, extra: Partial<Schemas["CostReportRow"]> = {}): Schemas["CostReportRow"] => ({
  key, label, deleted: false, spend, byKind: byKind(spend), tokens: 1200, requests: 0, unpriced: false, ...extra,
});

const report = (groupBy: Schemas["CostReport"]["groupBy"], rows: Schemas["CostReportRow"][]): Schemas["CostReport"] => ({
  from: "2026-09-01", to: "2026-09-02", groupBy, currency: "USD", timeZone: "America/New_York",
  total: { spend: "12.500000", byKind: byKind("12.500000"), tokens: 2400, requests: 3, unpriced: true }, rows,
});

const reports: Record<string, Schemas["CostReport"]> = {
  day: report("day", [row("2026-09-01", "2026-09-01", "12.500000"), row("2026-09-02", "2026-09-02", "0.000000")]),
  team: report("team", [row("t1", "Office of the Registrar", "12.500000", { teamSlug: "registrar", teamName: "Office of the Registrar" })]),
  agent: report("agent", [row("a1", "Registrar help", "12.000000", { teamName: "Office of the Registrar" }), row("", "Not from an agent (search, ingestion)", "0.500000")]),
  model: report("model", [row("m1", "Chat large", "12.500000", { modelKind: "chat" }), row("m2", "Embed", "0.000000", { unpriced: true })]),
};

const status = (state: Schemas["BudgetState"], extra: Partial<Schemas["TeamBudgetState"]> = {}): Schemas["TeamBudgetState"] => ({
  mode: "enforce", state, currency: "USD", month: "2026-09-01", resetsAt: "2026-10-01T04:00:00Z", budget: "100.000000", extensions: "0.000000",
  limit: "100.000000", spent: "85.000000", percent: 85, warnPercent: 80, ...extra,
});

const budgets: Schemas["BudgetList"] = {
  mode: "enforce", currency: "USD", timeZone: "America/New_York", month: "2026-09-01", resetsAt: "2026-10-01T04:00:00Z",
  items: [
    { teamId: "t1", teamSlug: "registrar", teamName: "Office of the Registrar", modeOverride: "inherit", ownBudget: true, status: status("warning"), projected: "110.000000" },
    { teamId: "t2", teamSlug: "library", teamName: "Library", modeOverride: "track", ownBudget: false, status: status("none", { mode: "track", budget: null, limit: null, percent: null, extensions: null, spent: "3.000000" }), projected: null },
  ],
};

const prices: Schemas["CostPriceList"] = {
  currency: "USD",
  items: [
    { modelId: "m1", modelKey: "chat-large", displayName: "Chat large", kind: "chat", enabled: true, unpriced: false,
      current: [{ unit: "chat_tokens_in", price: "3.000000", effectiveFrom: "2026-09-01" }, { unit: "chat_tokens_out", price: "15.000000", effectiveFrom: "2026-09-01" }] },
    { modelId: "m2", modelKey: "embed", displayName: "Embed", kind: "embedding", enabled: true, unpriced: true, current: [{ unit: "embed_tokens", price: null, effectiveFrom: null }] },
  ],
};

const costRoutes = (mode: Schemas["CostMode"]) => ({
  ...shellRoutes("platform_admin"),
  "GET /v1/admin/costs/settings": () => settings(mode),
  "GET /v1/admin/costs/report": (_: unknown, c: { search: URLSearchParams }) => reports[c.search.get("groupBy") ?? "day"],
  "GET /v1/admin/costs/budgets": () => budgets,
  "GET /v1/admin/costs/prices": () => prices,
});

describe("Admin → Costs", () => {
  it("shows only Prices and Settings while the mode is off", async () => {
    mockApi(costRoutes("off"));
    const { container } = renderApp("/admin/costs");
    expect(await screen.findByRole("heading", { name: "Costs", level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("Cost tracking is off")).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "Cost sections" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Prices", "Settings"]);
    expect(await screen.findByRole("link", { name: "Chat large" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("reports spend by day, team, agent and model, with CSV links and Unpriced flags", async () => {
    mockApi(costRoutes("track"));
    const { container } = renderApp("/admin/costs");
    const totals = await screen.findByRole("region", { name: "Totals" });
    expect(totals).toHaveTextContent(formatMoney("12.500000", "USD"));
    expect(await screen.findByRole("table", { name: "Spend per day" })).toHaveTextContent(formatMoney("12.500000", "USD"));
    expect(screen.getByRole("link", { name: "Download spend per day as CSV" }).getAttribute("href")).toMatch(/^\/v1\/admin\/costs\/report\.csv\?from=.*groupBy=day$/);
    const models = await screen.findByRole("table", { name: "Top models" });
    expect(within(models).getAllByText("Unpriced")).toHaveLength(1);
    const agents = await screen.findByRole("table", { name: "Top agents" });
    expect(agents).toHaveTextContent("Not from an agent (search, ingestion)");
    // An agent opens its admin page; usage without one isn't a link.
    expect(within(agents).getByRole("link", { name: "Registrar help" })).toHaveAttribute("href", "/admin/agents?record=a1");
    expect(within(agents).getAllByRole("link")).toHaveLength(1);
    // Cents everywhere: $12.00 next to $0.50, never $12 next to $0.5.
    expect(agents).toHaveTextContent(formatMoney("12", "USD"));
    expect(agents).toHaveTextContent(formatMoney("0.5", "USD"));
    expect(within(models).getByRole("columnheader", { name: "Per-request checks" })).toBeInTheDocument();
    expect(within(models).getByRole("link", { name: "Chat large" })).toHaveAttribute("href", "/admin/models?record=m1&from=costs");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("lists every team's budget state on the Budgets tab", async () => {
    mockApi(costRoutes("enforce"));
    const { container } = renderApp("/admin/costs?tab=budgets");
    const table = await screen.findByRole("table", { name: /Budgets for September 2026/ });
    expect(table).toHaveTextContent("Near budget");
    expect(table).toHaveTextContent("Team setting");
    expect(table).toHaveTextContent("Platform setting");
    expect(within(table).getByRole("columnheader", { name: /Budget this month/ })).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Office of the Registrar" })).toHaveAttribute("href", "/admin/teams/registrar?tab=limits");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("saves the settings with If-Match", async () => {
    const calls = mockApi({ ...costRoutes("off"), "PUT /v1/admin/costs/settings": (body) => ({ ...settings("track"), ...(body as object), revision: 5 }) });
    const { container } = renderApp("/admin/costs?tab=settings");
    const mode = await screen.findByRole("combobox", { name: "Cost tracking" });
    await userEvent.selectOptions(mode, "track");
    const budget = screen.getByRole("textbox", { name: /Default monthly budget/ });
    await userEvent.type(budget, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Save cost settings" }));
    expect(await screen.findByText(/Enter the default budget as a number/)).toBeInTheDocument();
    await userEvent.clear(budget);
    await userEvent.type(budget, "250");
    await userEvent.click(screen.getByRole("button", { name: "Save cost settings" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")).toBeDefined());
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"4"');
    expect(put.body).toEqual({ mode: "track", currency: "USD", timeZone: "America/New_York", warnPercent: 80, defaultBudget: "250" });
    expect(await axe(container)).toHaveNoViolations();
  });
});

const pricing: Schemas["ModelPricing"] = {
  modelId: "m1", modelKey: "chat-large", displayName: "Chat large", kind: "chat", currency: "USD", units: ["chat_tokens_in", "chat_tokens_out"],
  current: [{ unit: "chat_tokens_in", price: "3.000000", effectiveFrom: "2026-09-01" }, { unit: "chat_tokens_out", price: null, effectiveFrom: null }],
  history: [{ id: "p1", unit: "chat_tokens_in", price: "3.000000", effectiveFrom: "2026-09-01", createdAt: "2026-09-01T10:00:00Z", createdByName: "Ada Admin" }],
};

describe("a model's Pricing section", () => {
  it("marks upcoming prices and names the price a delete removes", async () => {
    const future: Schemas["ModelPrice"] = { id: "p2", unit: "chat_tokens_in", price: "4.000000", effectiveFrom: "2099-10-28", createdAt: "2026-09-28T10:00:00Z", createdByName: "Ada Admin" };
    mockApi({
      "GET /v1/admin/costs/settings": () => settings("track"),
      "GET /v1/admin/models/m1/prices": () => ({ ...pricing, history: [future, ...pricing.history] }),
    });
    const { container } = renderBare(<ModelPricingSection modelId="m1" isAdmin />, meFor("platform_admin"));
    expect(await screen.findByRole("heading", { name: "Now" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /^From Oct 28, 2099 \(upcoming\)$/ })).toBeInTheDocument();
    const history = screen.getByRole("table", { name: "Price history" });
    expect(within(history).getAllByText("Upcoming")).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: /Delete the input tokens price of \$4\.00 from Oct 28, 2099/ }));
    expect(await screen.findByRole("alertdialog", { name: /Delete the input tokens price of \$4\.00 from Oct 28, 2099\?/ })).toBeInTheDocument();
  });

  it("adds dated prices and deletes a row", async () => {
    const calls = mockApi({
      "GET /v1/admin/costs/settings": () => settings("track"),
      "GET /v1/admin/models/m1/prices": () => pricing,
      "POST /v1/admin/models/m1/prices": () => new Reply(201, { data: pricing }),
      "DELETE /v1/admin/models/m1/prices/p1": () => ({ ok: true }),
    });
    const { container } = renderBare(<ModelPricingSection modelId="m1" isAdmin />, meFor("platform_admin"));
    expect(await screen.findByRole("table", { name: "Price history" })).toHaveTextContent("Ada Admin");
    expect(screen.getByText("Unpriced")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Change prices" }));
    const dialog = await screen.findByRole("dialog", { name: "Change prices of Chat large" });
    expect(dialog).toHaveTextContent("in the platform time zone (America/New_York)");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Output tokens/ }), "15");
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save prices" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ prices: [{ unit: "chat_tokens_out", price: "15" }] }));

    await userEvent.click(await screen.findByRole("button", { name: /Delete the input tokens price/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete price" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/v1/admin/models/m1/prices/p1")).toBe(true));
  });
});

const teamBudget = (st: Schemas["TeamBudgetState"]): Schemas["TeamBudget"] => ({
  teamId: "t1", teamSlug: "registrar", teamName: "Office of the Registrar", modeOverride: "enforce", amount: "100.000000", warnPercent: null,
  defaultBudget: null, status: st, revision: 2,
  extensions: [{ id: "e1", month: "2026-09-01", amount: "20.000000", reason: "Exam period", createdByName: "Ada Admin", createdAt: "2026-09-10T10:00:00Z" }],
});

describe("a team's Budget card", () => {
  it("changes the budget with If-Match and grants an extension", async () => {
    const calls = mockApi({
      "GET /v1/admin/costs/settings": () => settings("off"),
      "GET /v1/admin/teams/registrar/budget": () => teamBudget(status("exhausted", { spent: "120.000000", extensions: "20.000000", limit: "120.000000", percent: 100 })),
      "PUT /v1/admin/teams/registrar/budget": () => teamBudget(status("ok")),
      "POST /v1/admin/teams/registrar/budget/extensions": () => new Reply(201, { data: teamBudget(status("ok")) }),
    });
    const { container } = renderBare(<AdminTeamBudgetCard team="registrar" />, meFor("platform_admin"));
    expect(await screen.findByText("Budget used up")).toBeInTheDocument();
    // The budget in force, as the Budgets tab counts it: the budget plus this month's extensions.
    expect(screen.getByText("Budget this month")).toBeInTheDocument();
    expect(screen.getByText(`${formatMoney("120", "USD")} (${formatMoney("100", "USD")} + ${formatMoney("20", "USD")} of extensions)`)).toBeInTheDocument();
    expect(screen.getByText("Team setting")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Extensions this month" })).toHaveTextContent("Exam period");
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Change budget" }));
    const dialog = await screen.findByRole("dialog", { name: "Budget of Office of the Registrar" });
    const amount = within(dialog).getByRole("textbox", { name: /Monthly budget/ });
    await userEvent.clear(amount);
    await userEvent.type(amount, "150");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save budget" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ mode: "enforce", amount: "150", warnPercent: null }));
    expect(calls.find((c) => c.method === "PUT")!.headers.get("If-Match")).toBe('"2"');

    await userEvent.click(await screen.findByRole("button", { name: "Grant extension" }));
    const ext = await screen.findByRole("dialog", { name: /Grant Office of the Registrar an extension/ });
    await userEvent.click(within(ext).getByRole("button", { name: "Grant extension" }));
    expect(await within(ext).findByText("Give a reason.")).toBeInTheDocument();
    await userEvent.type(within(ext).getByRole("textbox", { name: /Amount/ }), "50");
    await userEvent.type(within(ext).getByRole("textbox", { name: /Reason/ }), "Admissions week");
    await userEvent.click(within(ext).getByRole("button", { name: "Grant extension" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ amount: "50", reason: "Admissions week" }));
  });

  it("labels extensions as history when no budget is enforced", async () => {
    mockApi({
      "GET /v1/admin/costs/settings": () => settings("track"),
      "GET /v1/admin/teams/registrar/budget": () => ({
        ...teamBudget(status("none", { mode: "track", budget: null, extensions: null, limit: null, percent: null, spent: "3.000000" })), modeOverride: "inherit", amount: null,
      }),
    });
    const { container } = renderBare(<AdminTeamBudgetCard team="registrar" />, meFor("platform_auditor"));
    expect(await screen.findByRole("table", { name: /Extensions granted this month \(not counted: no budget is enforced\)/ })).toHaveTextContent("Exam period");
    expect(screen.getByText("Monthly budget")).toBeInTheDocument();
    expect(screen.getByText("Platform setting")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is hidden while costs are off and the team inherits", async () => {
    const calls = mockApi({
      "GET /v1/admin/costs/settings": () => settings("off"),
      "GET /v1/admin/teams/registrar/budget": () => ({ ...teamBudget(status("none", { mode: "off" })), modeOverride: "inherit" }),
    });
    const { container } = renderBare(<AdminTeamBudgetCard team="registrar" />, meFor("platform_auditor"));
    await waitFor(() => expect(calls).toHaveLength(2));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("the team's spend and banner", () => {
  it("shows owners the month's spend by agent and model", async () => {
    mockApi({
      "GET /v1/teams/registrar/spend": () => ({
        status: status("warning"), timeZone: "America/New_York", from: "2026-09-01", to: "2026-09-02",
        total: reports.agent!.total, agents: reports.agent!.rows, models: reports.model!.rows,
      }),
    });
    const { container } = renderBare(<TeamSpendCard team="registrar" />);
    expect(await screen.findByRole("table", { name: "By agent" })).toHaveTextContent("Registrar help");
    expect(screen.getByRole("table", { name: "By model" })).toHaveTextContent("Unpriced");
    expect(screen.getByText("Near budget")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "By agent" })).toHaveTextContent(formatMoney("0.5", "USD"));
    expect(screen.getAllByRole("columnheader", { name: "Per-request checks" })).toHaveLength(2);
    expect(screen.getByText(/count SystemOne and moderation requests/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("stays out of the way while cost tracking is off", async () => {
    const calls = mockApi({ "GET /v1/teams/registrar/spend": () => Reply.error(404, "costs_off", "Cost tracking is off for this team") });
    const { container } = renderBare(<TeamSpendCard team="registrar" />);
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("tells members the budget is used up, without amounts", async () => {
    mockApi({ "GET /v1/teams/registrar/budget-status": () => ({ state: "exhausted", resetsAt: "2026-10-01T04:00:00Z", amounts: null }) });
    const { container } = renderBare(<BudgetBanner team="registrar" manager={false} />, meFor("none", "member"));
    const alert = await screen.findByText("This team's monthly budget is used up");
    expect(alert.closest('[role="status"]')).toHaveTextContent(/Chats, searches and ingestion are paused/);
    expect(container).not.toHaveTextContent("$");
    expect(screen.queryByRole("link", { name: "See spend" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows owners the amounts near the threshold", async () => {
    mockApi({ "GET /v1/teams/registrar/budget-status": () => ({ state: "warning", resetsAt: "2026-10-01T04:00:00Z", amounts: { spent: "85.000000", limit: "100.000000", currency: "USD", percent: 85 } }) });
    renderBare(<BudgetBanner team="registrar" manager />);
    expect(await screen.findByText("This team is near its monthly budget")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${formatMoney("85", "USD").replace("$", "\\$")} of`))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See spend" })).toHaveAttribute("href", "/teams/registrar/settings?tab=usage");
  });
});

describe("budget errors and money", () => {
  it("explains budget_exhausted in chat and a generic unavailable to visitors", () => {
    expect(chatErrorText("budget_exhausted", "Your team's monthly budget is used up.").title).toBe("The team's monthly budget is used up");
    expect(chatErrorText("agent_unavailable").title).toBe("This assistant is unavailable right now");
  });

  it("shows money in cents, under a cent as < $0.01, with the exact amount kept for hover", () => {
    const usd = (n: number, d = 2) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
    expect(formatMoney("12.500000", "USD")).toBe(usd(12.5));
    expect(formatMoney("0.140000", "USD")).toBe(usd(0.14));
    expect(formatMoney("0.027129", "USD")).toBe(usd(0.03));
    expect(formatMoney("0.000123", "USD")).toBe(`< ${usd(0.01)}`);
    expect(formatMoney("0.009999", "USD")).toBe(`< ${usd(0.01)}`);
    expect(formatMoney("0.000000", "USD")).toBe(usd(0));
    expect(formatMoney(null, "USD")).toBe("—");
    expect(formatMoney("5", "XYZ")).toMatch(/5/);
    expect(formatMoneyExact("0.027129", "USD")).toBe(usd(0.027129, 6));
    expect(formatMoneyExact("5.000000", "USD")).toBe(usd(5));
    expect(formatMoneyExact("0.000150", "USD")).toBe(usd(0.00015, 5));
  });

  it("puts the exact amount on hover when cents round it", async () => {
    const { container } = renderBare(
      <p>
        <Money amount="0.027129" currency="USD" /> and <Money amount="5.000000" currency="USD" />
      </p>,
    );
    expect(await screen.findByTitle(formatMoneyExact("0.027129", "USD"))).toHaveTextContent(formatMoney("0.03", "USD"));
    expect(container.querySelectorAll("[title]")).toHaveLength(1);
  });

  it("links budget changes and extensions to the team's Limits tab", () => {
    const e = (action: string): Schemas["AuditEntry"] => ({
      id: 1, occurredAt: "2026-09-26T10:00:00Z", actorKind: "system", actor: { kind: "system" }, actorUserId: null, teamId: "t1", action, targetType: "team", targetId: "t1",
      targetLabel: "Office of the Registrar", targetExists: true, parent: null, before: null, after: null, metadata: {}, requestId: "",
    });
    renderBare(
      <>
        <AuditTarget entry={e("costs.extension_grant")} scope={{ kind: "platform" }} />
        <AuditTarget entry={e("team.update")} scope={{ kind: "platform" }} />
      </>,
    );
    return waitFor(() => {
      const links = screen.getAllByRole("link", { name: "Office of the Registrar" });
      expect(links.map((l) => l.getAttribute("href"))).toEqual(["/admin/teams/t1?tab=limits", "/admin/teams/t1"]);
    });
  });
});
