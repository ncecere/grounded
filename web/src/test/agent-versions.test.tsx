/*
 * The agent editor's 6 tabs and its version menu (I6, docs/v0.2.1.md): the
 * header's "v1 live" badge opens Version history, Compare versions and
 * Revert; the history is a record page (?history=), and the old Versions tab's
 * addresses redirect there.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { configInput } from "../pages/agents/common";
import { type Handler, meFor, mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => vi.unstubAllGlobals());

const config: Schemas["AgentConfig"] = {
  instructions: "Help students.",
  chatModelId: "mod1",
  kbs: [{ kbId: "kb1", topK: 6 }],
  retrievalMode: "always",
  maxTurns: 4,
  contextTokenBudget: 6000,
  minSimilarity: 0,
  strictlyGrounded: true,
  refusalMessage: "I couldn't find that.",
  citationMode: "snippet_link",
  queryRewrite: true,
  moderation: { categories: {}, outputMode: "" },
  audience: "team",
};
const version: Schemas["AgentVersion"] = {
  id: "v1",
  version: 1,
  publishedAt: "2026-09-26T10:00:00Z",
  publishedBy: "u1",
  publishedByName: "Una User",
  note: "First version",
  chatModelId: "mod1",
  chatModelName: "Chat model",
  effectiveRank: 0,
  classification: "open",
  knowledgeBases: [{ id: "kb1", name: "Registrar help", topK: 6, inherited: false }],
  config,
};
const agent = (extra: Partial<Schemas["Agent"]> = {}): Schemas["Agent"] => ({
  id: "ag1",
  teamId: "t1",
  teamSlug: "registrar",
  slug: "registrar-assistant",
  name: "Registrar assistant",
  description: "",
  accentColor: "",
  welcomeMessage: "Hi!",
  starterQuestions: [],
  status: "active",
  disabledReason: "",
  disabledAt: null,
  audience: "team",
  draft: config,
  draftRevision: 1,
  published: version,
  hasUnpublishedChanges: true,
  warnings: [],
  revision: 2,
  createdAt: "2026-09-26T09:00:00Z",
  updatedAt: "2026-09-26T10:00:00Z",
  ...extra,
});

function routes(current = agent(), extra: Record<string, Handler> = {}): Record<string, Handler> {
  const me = meFor("none", "owner");
  return {
    ...shellRoutes(),
    "GET /v1/me": () => ({ ...me, capabilities: { ...me.capabilities, evaluations: true } }),
    "GET /v1/teams/registrar/agents": () => [current],
    "GET /v1/teams/registrar/agents/ag1": () => current,
    "GET /v1/teams/registrar/agents/ag1/versions": () => [version],
    "GET /v1/teams/registrar/agents/ag1/versions/1": () => version,
    "GET /v1/chat-models": () => [],
    "GET /v1/teams/registrar/kbs": () => [],
    "GET /v1/teams/registrar/evaluation-sets": () => [],
    ...extra,
  };
}

const T = { timeout: 5000 };

describe("the agent editor's tabs and version menu (I6)", () => {
  it("has 6 tabs, and the version badge is a menu that opens the history as a record page", async () => {
    const user = userEvent.setup();
    mockApi(routes());
    const { container, router } = renderApp("/teams/registrar/agents/ag1");
    expect(await screen.findByRole("tab", { name: "Build", selected: true }, T)).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Build", "Evaluations", "Appearance", "Share", "Analytics", "Settings"]);
    const badge = screen.getByRole("button", { name: "v1 live" });
    expect(await axe(container)).toHaveNoViolations();

    await user.click(badge);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Version history", "Compare versions", "Revert draft to v1…"]);
    await user.click(within(menu).getByRole("menuitem", { name: "Version history" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ history: "versions" }));
    const page = await screen.findByRole("region", { name: "Version history" });
    expect(within(page).getByRole("heading", { level: 1, name: "Version history" })).toBeInTheDocument();
    expect(await within(page).findByRole("table", { name: "Published versions" })).toHaveTextContent("First version");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/Registrar assistant.*Version history/);
    expect(await axe(container)).toHaveNoViolations();

    // A version opens on top of the history, and its back link returns there.
    await user.click(within(page).getByRole("button", { name: "Actions for version 1" }));
    await user.click(await screen.findByRole("menuitem", { name: "View details" }));
    const v1 = await screen.findByRole("region", { name: "Version 1" });
    expect(router.state.location.search).toMatchObject({ history: "versions", version: 1 });
    await user.click(within(v1).getByRole("link", { name: "Back to Version history" }));
    expect(await screen.findByRole("region", { name: "Version history" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "Version history" })).getByRole("link", { name: /^Back/ }));
    expect(await screen.findByRole("tab", { name: "Build", selected: true })).toBeVisible();
  });

  it("opens Compare versions alone", async () => {
    const user = userEvent.setup();
    mockApi(routes());
    const { router } = renderApp("/teams/registrar/agents/ag1");
    await user.click(await screen.findByRole("button", { name: "v1 live" }, T));
    await user.click(await screen.findByRole("menuitem", { name: "Compare versions" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ history: "compare" }));
    const page = await screen.findByRole("region", { name: "Compare versions" });
    expect(await within(page).findByRole("combobox", { name: "From" })).toBeInTheDocument();
    expect(within(page).queryByRole("table", { name: "Published versions" })).toBeNull();
  });

  it("reverts the draft to the live version from the menu", async () => {
    const user = userEvent.setup();
    const calls = mockApi(routes(agent(), { "POST /v1/teams/registrar/agents/ag1/revert": () => agent({ hasUnpublishedChanges: false, revision: 3 }) }));
    renderApp("/teams/registrar/agents/ag1");
    await user.click(await screen.findByRole("button", { name: "v1 live" }, T));
    await user.click(await screen.findByRole("menuitem", { name: "Revert draft to v1…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Replace the draft with version 1?" });
    await user.click(within(dialog).getByRole("button", { name: "Revert draft" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/revert"))?.body).toEqual({ version: 1 }));
  });

  it("says Draft before the first publish, with only the history in its menu", async () => {
    const user = userEvent.setup();
    mockApi(routes(agent({ published: null, hasUnpublishedChanges: false }), { "GET /v1/teams/registrar/agents/ag1/versions": () => [] }));
    renderApp("/teams/registrar/agents/ag1");
    await user.click(await screen.findByRole("button", { name: "Draft" }, T));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Version history"]);
  });
});

describe("the old Versions tab's addresses (I6)", () => {
  it("redirects ?tab=versions to the version history", async () => {
    mockApi(routes());
    const { router } = renderApp("/teams/registrar/agents/ag1?tab=versions");
    expect(await screen.findByRole("region", { name: "Version history" }, T)).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ history: "versions" });
  });

  it("redirects a version's old record link, keeping the comparison's choice", async () => {
    mockApi(routes());
    const { router } = renderApp("/teams/registrar/agents/ag1?tab=versions&record=1&from=1&to=draft");
    expect(await screen.findByRole("region", { name: "Version 1" }, T)).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ history: "versions", version: 1, from: 1, to: "draft" });
  });
});

describe("a draft's configuration as saved", () => {
  it("keeps any SystemOne override, citation checks or the scope check alone too, and leaves out an empty one", () => {
    expect(configInput({ ...config, systemOne: { citations: "on" } }).systemOne).toEqual({ citations: "on" });
    expect(configInput({ ...config, systemOne: { scope: "off" } }).systemOne).toEqual({ scope: "off" });
    expect(configInput({ ...config, systemOne: { judging: "" } }).systemOne).toBeUndefined();
    expect(configInput(config).systemOne).toBeUndefined();
  });
});
