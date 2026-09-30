/* The audit log and MCP: agents' tool calls are their own area, apart from what AI tools did over the MCP server, and entries say how the person acted (API key, connected app). */
import { screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { actedHow, actedVia, areaOf, areaOptions } from "../components/audit/labels";
import { mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const entry = (id: number, action: string, extra: Partial<Schemas["AuditEntry"]> = {}): Schemas["AuditEntry"] => ({
  id, occurredAt: "2026-09-26T10:00:00Z", actorKind: "user", actor: { kind: "user", userId: "u2", email: "alex@example.edu", displayName: "Alex" },
  actorUserId: "u2", teamId: null, action, targetType: "agent", targetId: "a1", targetLabel: "Helper", targetExists: true, parent: null,
  before: null, after: null, metadata: {}, requestId: "req-1", ...extra,
});

describe("audit areas for MCP", () => {
  it("files agents' tool calls with the MCP servers and approvals, apart from AI tools' searches and questions", () => {
    const tools = "Agents' MCP tools: calls, servers and approvals";
    const clients = "MCP server: AI tools' searches and questions";
    expect(areaOf("mcp.tool_call")).toBe(tools);
    expect(areaOf("mcp_server.create")).toBe(tools);
    expect(areaOf("mcp_tool.approve")).toBe(tools);
    expect(areaOf("mcp.search")).toBe(clients);
    expect(areaOf("mcp.ask")).toBe(clients);
    const labels = areaOptions(true).map((o) => o.label);
    expect(labels).toContain(`${tools} (all)`);
    expect(labels.some((l) => /\)\s*\(all\)$/.test(l))).toBe(false);
    expect(areaOptions(true).find((o) => o.label === `${clients} (all)`)?.value).toBe("mcp_clients.");
    // The team log offers both (its agents' calls are team entries).
    expect(areaOptions(false).map((o) => o.value)).toEqual(expect.arrayContaining(["mcp_clients.", "agent_tools."]));
  });

  it("says how the person acted", () => {
    expect(actedVia(entry(1, "mcp.search", { actorKind: "api_key", actor: { kind: "api_key", apiKeyName: "Sync" } }))).toBe("API key: Sync");
    expect(actedVia(entry(1, "mcp.search", { metadata: { via: "oauth", oauthClient: "Research Assistant" } }))).toBe("Connected app: Research Assistant");
    expect(actedVia(entry(1, "agent.publish"))).toBeUndefined();
    expect(actedHow(entry(1, "agent.publish"))).toBe("In the app (signed in)");
    expect(actedHow(entry(1, "retention.run", { actorKind: "system", actor: { kind: "system" } }))).toBeUndefined();
  });

  it("shows the connected app in the list and on the record page", async () => {
    const oauth = entry(42, "mcp.ask", { metadata: { via: "oauth", oauthGrantId: "g1", oauthClient: "Research Assistant" } });
    mockApi({
      ...shellRoutes("platform_auditor"),
      "GET /v1/admin/audit": () => ({ items: [oauth], nextCursor: null }),
      "GET /v1/admin/users": () => ({ items: [], nextCursor: null }),
    });
    const { container } = renderApp("/admin/logs?record=42");
    const page = await screen.findByRole("region", { name: "Asked an agent over MCP" }, { timeout: 4000 });
    const how = within(page).getByText("How").closest("div")!;
    expect(how).toHaveTextContent("Connected app: Research Assistant");
    expect(await axe(container)).toHaveNoViolations();
  });
});
