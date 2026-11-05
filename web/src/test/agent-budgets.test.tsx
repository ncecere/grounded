/* Per-agent budgets in Team settings › Usage & spend (docs/specs/agent-budgets/DESIGN.md): each agent's spend and budget,
 * set by owners and admins, read-only otherwise. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { budgetProblem } from "../pages/team/agent-budgets";
import { TeamSpendCard } from "../pages/team/spend";
import { mockApi, renderBare } from "./harness";

const byKind = { chat: "0.240000", embedding: "0", systemone: "0", moderation: "0", ocr: "0", mcp: "0", rerank: "0" };
const row = (key: string, label: string, spend: string): Schemas["CostReportRow"] => ({ key, label, deleted: false, spend, byKind, tokens: 10, requests: 0, unpriced: false });

const spend = (budgets: Schemas["AgentBudget"][]): Schemas["TeamSpend"] => ({
  status: {
    mode: "enforce", state: "ok", enforced: true, currency: "USD", month: "2026-11-01", resetsAt: "2026-12-01T00:00:00Z", budget: "100.000000",
    extensions: "0.000000", limit: "100.000000", spent: "12.000000", percent: 12, warnPercent: 80,
  },
  timeZone: "UTC", from: "2026-11-01", to: "2026-11-05",
  total: { spend: "12.000000", byKind, tokens: 20, requests: 0, unpriced: false },
  agents: [row("a1", "Registrar help", "10.000000"), row("a2", "Advising", "2.000000")],
  models: [],
  agentBudgets: budgets,
});

const agent = (id: string, name: string) => ({ id, name }) as unknown as Schemas["Agent"];
const budget: Schemas["AgentBudget"] = {
  agentId: "a1", amount: "10.000000", spent: "10.000000", currency: "USD", state: "exhausted", enforced: true, resetsAt: "2026-12-01T00:00:00Z", revision: 3,
};

describe("agent budgets", () => {
  it("checks an amount before saving", () => {
    expect(budgetProblem("")).toBeUndefined();
    expect(budgetProblem("25.5")).toBeUndefined();
    expect(budgetProblem("-1")).toMatch(/Enter an amount/);
    expect(budgetProblem("1.1234567")).toMatch(/Enter an amount/);
  });

  it("shows each agent's spend and budget, and an owner sets one", async () => {
    const calls = mockApi({
      "GET /v1/teams/registrar/spend": () => spend([budget]),
      "GET /v1/teams/registrar/agents": () => [agent("a1", "Registrar help"), agent("a2", "Advising")],
      "PUT /v1/teams/registrar/agents/a2/budget": () => ({ ...budget, agentId: "a2", amount: "5.000000", spent: "2.000000", state: "ok", revision: 2 }),
    });
    const { container } = renderBare(<TeamSpendCard team="registrar" canEditBudgets />);
    await userEvent.click(await screen.findByRole("button", { name: /Spend breakdown/ }));
    const table = await screen.findByRole("table", { name: "Agent budgets" });
    expect(within(table).getByText("Used up")).toBeInTheDocument();
    expect(within(table).getByText("None")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(table).getByRole("button", { name: "Set budget for Advising" }));
    const dialog = await screen.findByRole("dialog", { name: "Budget for Advising" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Monthly budget" }), "five");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save budget" }));
    expect(await within(dialog).findByText(/Enter an amount/)).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Monthly budget" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Monthly budget" }), "5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save budget" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ amount: "5" }));
    expect(calls.find((c) => c.method === "PUT")!.headers.get("If-Match")).toBe('"1"');
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Budget for Advising" })).toBeNull());
  });

  it("is read-only without the right to change it", async () => {
    mockApi({
      "GET /v1/teams/registrar/spend": () => spend([budget]),
      "GET /v1/teams/registrar/agents": () => [agent("a1", "Registrar help")],
    });
    renderBare(<TeamSpendCard team="registrar" />);
    await userEvent.click(await screen.findByRole("button", { name: /Spend breakdown/ }));
    const table = await screen.findByRole("table", { name: "Agent budgets" });
    expect(within(table).queryByRole("button")).toBeNull();
  });
});
