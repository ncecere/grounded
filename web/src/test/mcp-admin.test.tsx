/*
 * Admin → MCP servers, guarded changes: a blocked delete names the agents that use the server, withdrawing a used
 * tool's approval asks first and names them, and auditors are told the pages are read-only.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { type Handler, mockApi, Reply, renderApp, shellRoutes } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const at = "2026-09-29T10:00:00Z";
const server: Schemas["MCPServer"] = {
  id: "s1", name: "Service status", description: "", url: "https://status.example.edu/mcp", hasAuth: false, authValueHint: "",
  maxClassification: "open", timeoutSeconds: 30, enabled: true, toolCount: 2, approvedCount: 1, toolsRefreshedAt: at, revision: 3,
  createdAt: at, updatedAt: at,
};
const use: Schemas["MCPToolUse"] = { agentId: "ag1", agentName: "Help Desk Assistant", teamSlug: "it", teamName: "IT Help Desk", version: 3 };
const tool = (id: string, name: string, over: Partial<Schemas["MCPServerTool"]> = {}): Schemas["MCPServerTool"] => ({
  id, serverId: "s1", name, title: "", description: `Does ${name}.`, inputSchema: { type: "object" }, approved: true, firstSeenAt: at,
  lastSeenAt: at, usedBy: [], ...over,
});

const routes = (role: "platform_admin" | "platform_auditor", extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes(role),
  "GET /v1/admin/mcp-servers": () => [server],
  "GET /v1/admin/health-checks": () => [],
  "GET /v1/admin/mcp-servers/s1/tools": () => [tool("t1", "check_outage", { usedBy: [use] }), tool("t2", "room_lookup")],
  ...extra,
});

describe("Admin → MCP servers: guarded changes", () => {
  it("names the agents that use a tool, and asks before withdrawing its approval", async () => {
    const calls = mockApi(routes("platform_admin", { "PUT /v1/admin/mcp-servers/s1/tools/t1/approval": () => tool("t1", "check_outage", { approved: false }) }));
    const { container } = renderApp("/admin/mcp-servers?record=s1");
    const sheet = await screen.findByRole("region", { name: "Service status" }, { timeout: 4000 });
    const item = within(await within(sheet).findByRole("list", { name: "Tools of Service status" })).getByRole("listitem", { name: "check_outage" });
    expect(within(item).getByRole("link", { name: "Help Desk Assistant" })).toHaveAttribute("href", "/admin/agents?record=ag1");
    expect(item).toHaveTextContent("(IT Help Desk), version 3");
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(item).getByRole("button", { name: "Withdraw approval of check_outage" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Withdraw approval of check_outage?" });
    expect(within(dialog).getByRole("list", { name: "Agents that use check_outage" })).toHaveTextContent("Help Desk Assistant");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Withdraw approval" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ approved: false }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("withdraws the approval of an unused tool at once", async () => {
    const calls = mockApi(routes("platform_admin", { "PUT /v1/admin/mcp-servers/s1/tools/t2/approval": () => tool("t2", "room_lookup", { approved: false }) }));
    renderApp("/admin/mcp-servers?record=s1");
    const sheet = await screen.findByRole("region", { name: "Service status" }, { timeout: 4000 });
    await userEvent.click(await within(sheet).findByRole("button", { name: "Withdraw approval of room_lookup" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ approved: false }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("names the agents that block a delete instead of offering Delete", async () => {
    const calls = mockApi(routes("platform_admin"));
    const { container } = renderApp("/admin/mcp-servers?record=s1");
    const sheet = await screen.findByRole("region", { name: "Service status" }, { timeout: 4000 });
    await within(sheet).findByRole("list", { name: "Tools of Service status" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Service status can't be deleted" });
    expect(dialog).toHaveTextContent("Disable the server instead");
    expect(within(dialog).getByRole("link", { name: "Help Desk Assistant" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("shows the agents a refused delete names", async () => {
    mockApi(
      routes("platform_admin", {
        "GET /v1/admin/mcp-servers/s1/tools": () => [tool("t2", "room_lookup")],
        "DELETE /v1/admin/mcp-servers/s1": () =>
          new Reply(409, {
            error: {
              code: "mcp_server_in_use",
              message: "Published agents use this server's tools.",
              details: { agents: [{ id: "ag2", name: "Library Guide", teamSlug: "lib", teamName: "Library", version: 2 }] },
            },
          }),
      }),
    );
    renderApp("/admin/mcp-servers?record=s1");
    const sheet = await screen.findByRole("region", { name: "Service status" }, { timeout: 4000 });
    await within(sheet).findByRole("list", { name: "Tools of Service status" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete Service status?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Service status can't be deleted" });
    expect(dialog).toHaveTextContent("Library Guide (Library), version 2");
  });

  it("tells auditors the pages are read-only", async () => {
    mockApi(routes("platform_auditor"));
    renderApp("/admin/mcp-servers");
    expect(await screen.findByText("You can view the servers and their tools. Only platform admins can change them.", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/Add a server, read its tools/)).not.toBeInTheDocument();
  });
});
