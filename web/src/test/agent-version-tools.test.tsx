/*
 * An agent's MCP tools in its history (docs/mcp-client.md): a version's page, Compare versions and a member's
 * read-only summary list Tools like the other settings, by name; problems read as sentences.
 */
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { ProblemList, asSentence } from "../pages/agents/common";
import { changedRows, configRows } from "../pages/agents/config-rows";
import { type Handler, mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => vi.unstubAllGlobals());

const config: Schemas["AgentConfig"] = {
  instructions: "Help with IT questions.", chatModelId: "mod1", kbs: [{ kbId: "kb1", topK: 6 }], retrievalMode: "always", maxTurns: 4,
  contextTokenBudget: 6000, minSimilarity: 0, strictlyGrounded: true, refusalMessage: "No.", citationMode: "snippet_link", queryRewrite: true,
  moderation: { categories: {}, outputMode: "" }, audience: "team",
};
const withTool = { ...config, tools: ["t1"] };
const checkOutage: Schemas["AgentVersionTool"] = { id: "t1", name: "check_outage", title: "Check outage", serverName: "Service status" };

const version = (n: number, cfg: Schemas["AgentConfig"], tools?: Schemas["AgentVersionTool"][]): Schemas["AgentVersion"] => ({
  id: `v${n}`, version: n, publishedAt: "2026-09-26T10:00:00Z", publishedBy: "u1", publishedByName: "Una User", note: "", chatModelId: "mod1",
  chatModelName: "Chat model", effectiveRank: 0, classification: "open", knowledgeBases: [{ id: "kb1", name: "IT help", topK: 6, inherited: false }],
  config: cfg, tools,
});
const v2 = version(2, config);
const v3 = version(3, withTool, [checkOutage]);

const agent: Schemas["Agent"] = {
  id: "ag1", teamId: "t1", teamSlug: "registrar", slug: "helper", name: "Helper", description: "", accentColor: "", welcomeMessage: "", starterQuestions: [],
  status: "active", disabledReason: "", disabledAt: null, audience: "team", draft: withTool, draftRevision: 1, published: v3, hasUnpublishedChanges: false,
  warnings: [], revision: 2, createdAt: "2026-09-26T09:00:00Z", updatedAt: "2026-09-26T10:00:00Z",
};

const routes = (role: "owner" | "member", extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes("none", role),
  "GET /v1/teams/registrar/agents": () => [agent],
  "GET /v1/teams/registrar/agents/ag1": () => agent,
  "GET /v1/teams/registrar/agents/ag1/versions": () => [v3, v2],
  "GET /v1/teams/registrar/agents/ag1/versions/2": () => v2,
  "GET /v1/teams/registrar/agents/ag1/versions/3": () => v3,
  "GET /v1/chat-models": () => [],
  "GET /v1/teams/registrar/kbs": () => [],
  "GET /v1/teams/registrar/evaluation-sets": () => [],
  "GET /v1/mcp-tools": () => [],
  ...extra,
});

const T = { timeout: 5000 };

describe("an agent's tools in its versions", () => {
  it("a version's page lists its tools by name", async () => {
    mockApi(routes("owner"));
    const { container } = renderApp("/teams/registrar/agents/ag1?history=versions&version=3");
    const page = await screen.findByRole("region", { name: /^Version 3/ }, T);
    const row = (await within(page).findByText("Tools")).closest("div")!;
    expect(row).toHaveTextContent("Check outage (Service status)");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Compare lists the added tool", async () => {
    mockApi(routes("owner"));
    renderApp("/teams/registrar/agents/ag1?history=compare&from=2&to=3");
    const table = await screen.findByRole("table", { name: "Settings that changed from version 2 to version 3" }, T);
    const row = within(table).getByRole("cell", { name: "Tools" }).closest("tr")!;
    expect(row).toHaveTextContent("None");
    expect(row).toHaveTextContent("Check outage (Service status)");
    expect(screen.queryByText("No setting changed.")).toBeNull();
  });

  it("a member's read-only summary shows the tools the agent may call", async () => {
    mockApi(routes("member"));
    renderApp("/teams/registrar/agents/ag1");
    expect(await screen.findByText("Check outage (Service status)", undefined, T)).toBeInTheDocument();
  });

  it("names a tool that is gone, and changes nothing else", () => {
    const names = { model: () => "Chat model", kb: () => "IT help", tool: (id: string) => (id === "t1" ? "Check outage (Service status)" : "A tool that is no longer available") };
    expect(configRows({ ...config, tools: ["t1", "t9"] }, names).find((r) => r.key === "tools")?.value).toBe(
      "Check outage (Service status), A tool that is no longer available",
    );
    expect(configRows(config, names).find((r) => r.key === "tools")?.value).toBe("None");
    expect(changedRows(config, withTool, names)).toEqual([{ label: "Tools", before: "None", after: "Check outage (Service status)" }]);
  });
});

describe("problems as sentences", () => {
  it("adds the final period the server leaves out, once", () => {
    expect(asSentence("Choose a chat model")).toBe("Choose a chat model.");
    expect(asSentence("Already a sentence.")).toBe("Already a sentence.");
    render(<ProblemList problems={[{ field: "tools[0]", problem: "Service status is turned off, so Check outage can't be used" }]} onSelect={() => {}} />);
    expect(screen.getByRole("listitem")).toHaveTextContent(/Service status is turned off, so Check outage can't be used\.$/);
  });
});
