/* #143: a long unbroken name wraps in the page title and in the list's name cell instead of widening the page. */
import { readFileSync } from "node:fs";
import { screen, within } from "@testing-library/react";
import { mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const long = `qa-long-${"W".repeat(92)}`;
const longModel = `qa-model-${"M".repeat(91)}`;

describe("long unbroken names", () => {
  // jsdom does no layout, so this only reads the rule. Whether the page stops scrolling sideways was not checked in a browser.
  it("the page header's title may break anywhere and shrink inside its row", () => {
    const css = readFileSync("src/components/ui/page-header/page-header.module.css", "utf8");
    const rule = /(?:^|\n)\.title \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule).toMatch(/min-width:\s*0/);
  });

  it("the connection's models and the Models list's Connection column break long names too", () => {
    const css = readFileSync("src/pages/admin/models/models.module.css", "utf8");
    expect(/(?:^|\n)\.usedBy \{([^}]*)\}/.exec(css)?.[1] ?? "").toMatch(/overflow-wrap:\s*anywhere/);
    expect(/(?:^|\n)\.breakName \{([^}]*)\}/.exec(css)?.[1] ?? "").toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("the Teams list lets the team's name break anywhere", async () => {
    const team = { id: "t9", slug: "qa-long", name: long, description: "", maxClassification: "open", status: "active", revision: 1, createdAt: "", updatedAt: "" };
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/users": () => ({ items: [], nextCursor: null }),
      "GET /v1/admin/teams": () => ({ items: [{ team, memberCount: 1, ownerCount: 1, ownerInvites: 0, agentCount: 0, sourceCount: 0, kbCount: 0, documentCount: 0, storageBytes: 0 }], nextCursor: null }),
    });
    renderApp("/admin/teams");
    const table = await screen.findByRole("table", { name: "Teams" }, { timeout: scaled(4000) });
    const name = await within(table).findByRole("link", { name: long });
    expect(name.closest("[data-wrap]")).toHaveAttribute("data-wrap", "anywhere");
  });

  it("the Models and Connections lists let the name break anywhere", async () => {
    const connection = {
      id: "c1", name: long, description: "", baseUrl: "https://ai.example.edu/v1", hasApiKey: false, apiKeyHint: "", timeoutSeconds: 60,
      requestsPerMinute: null, maxConcurrentRequests: 8, enabled: true, modelCount: 1, revision: 1, createdAt: "", updatedAt: "",
    };
    const model = {
      id: "m1", connectionId: "c1", key: "long", upstreamModel: "x", displayName: longModel, description: "", kind: "chat", maxClassification: "open", enabled: true,
      supportsTools: false, supportsVision: false, contextWindow: 1000, compat: {}, revision: 1, createdAt: "", updatedAt: "2026-09-26T10:00:00Z",
    };
    const routes = {
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => [connection],
      "GET /v1/admin/models": () => [model],
      "GET /v1/admin/catalog-usage": () => ({ models: [], profiles: [] }),
    };
    mockApi(routes);
    const models = renderApp("/admin/models");
    const mt = await screen.findByRole("table", { name: "Models" }, { timeout: scaled(4000) });
    expect((await within(mt).findByText(longModel)).closest("[data-wrap]")).toHaveAttribute("data-wrap", "anywhere");
    // The Connection column names the connection, with the same long name.
    expect(within(mt).getByText(long).className).toMatch(/breakName/);
    models.unmount();
    renderApp("/admin/connections");
    const ct = await screen.findByRole("table", { name: "Connections" }, { timeout: scaled(4000) });
    expect((await within(ct).findByText(long)).closest("[data-wrap]")).toHaveAttribute("data-wrap", "anywhere");
  });
});
