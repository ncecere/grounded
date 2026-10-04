/* The agent editor's Build tab (D2/W2) and honest status (Q5): section summaries, publish states, the Test drawer and the old tab links. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { sectionSummary } from "../pages/agents/build/summaries";
import { publishBlocked, saveView } from "../pages/agents/publish-state";
import { type Handler, mockApi, renderApp, shellRoutes } from "./harness";

const config: Schemas["AgentConfig"] = {
  instructions: "Help students with registration.",
  chatModelId: "mod1",
  kbs: [{ kbId: "kb1", topK: 6 }],
  retrievalMode: "always",
  maxTurns: 4,
  contextTokenBudget: 6000,
  minSimilarity: 0,
  strictlyGrounded: true,
  refusalMessage: "No.",
  citationMode: "snippet_link",
  queryRewrite: true,
  moderation: { categories: {}, outputMode: "" },
  audience: "team",
};

const version = {
  id: "v1", version: 3, publishedAt: "2026-09-26T10:00:00Z", publishedBy: "u1", publishedByName: "Una", note: "", chatModelId: "mod1",
  chatModelName: "GPT-OSS 120B (Campus gateway)", effectiveRank: 0, classification: "open", knowledgeBases: [{ id: "kb1", name: "Registrar help", topK: 6, inherited: false }], config,
};

const agent = (extra: Partial<Schemas["Agent"]> = {}): Schemas["Agent"] => ({
  id: "ag1", teamId: "t1", teamSlug: "registrar", slug: "helper", name: "Helper", description: "", accentColor: "", welcomeMessage: "", starterQuestions: [],
  status: "active", disabledReason: "", disabledAt: null, audience: "team", draft: config, draftRevision: 1, published: version, hasUnpublishedChanges: false,
  warnings: [], revision: 2, createdAt: "2026-09-26T09:00:00Z", updatedAt: "2026-09-26T10:00:00Z", ...extra,
});

const models = [
  { id: "mod1", key: "gpt-oss-120b", displayName: "GPT-OSS 120B (Campus gateway)", description: "", maxClassification: "sensitive", contextWindow: 131072, maxOutputTokens: 8192, supportsTools: true, supportsReasoningEffort: false, supportsThinkingOff: false, health: { status: "healthy" as const } },
];
const kb = { id: "kb1", name: "Registrar help", description: "", embeddingProfileId: "p1", topK: 8, effectiveClassification: "open", sources: [], revision: 1, createdAt: "", updatedAt: "" };

const routes = (current: Schemas["Agent"], extra: Record<string, Handler> = {}, teamRole = "owner"): Record<string, Handler> => ({
  ...shellRoutes("none", teamRole),
  "GET /v1/teams/registrar/agents/ag1": () => current,
  "GET /v1/teams/registrar/agents/ag1/versions": () => [version],
  "GET /v1/chat-models": () => models,
  "GET /v1/teams/registrar/kbs": () => [kb],
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

describe("pure helpers", () => {
  it("summarises each closed section in a line", () => {
    const input = { c: config, model: models[0], kbName: (id: string) => (id === "kb1" ? "Registrar help" : undefined) };
    expect(sectionSummary("instructions", input)).toBe("Help students with registration.");
    expect(sectionSummary("instructions", { ...input, c: { ...config, instructions: "" } })).toBe("Not written yet");
    expect(sectionSummary("model", input)).toBe("GPT-OSS 120B (Campus gateway)");
    expect(sectionSummary("knowledge", input)).toBe("Registrar help");
    expect(sectionSummary("knowledge", { ...input, c: { ...config, kbs: [] } })).toMatch(/can't answer yet/);
    expect(sectionSummary("answering", input)).toBe("Search before every answer · only from sources · title, snippet and link");
    expect(sectionSummary("safety", input)).toBe("Platform policy only");
    expect(sectionSummary("advanced", input)).toBe("model's temperature · 6,000 source tokens · rewrites follow-ups · suggests follow-ups");
    // Reasoning and answer length first, and reranking once the platform has a rerank model (BU-15).
    const tuned = { ...input, c: { ...config, reasoningEffort: "off" as const, maxOutputTokens: 600, rerankTopN: 4 }, rerank: { defaultTopN: 6 } };
    expect(sectionSummary("advanced", tuned)).toBe(
      "reasoning off · answers up to 600 tokens · model's temperature · 6,000 source tokens · reranks, keeps 4 · rewrites follow-ups · suggests follow-ups",
    );
    expect(sectionSummary("advanced", { ...tuned, c: { ...tuned.c, rerank: false } })).toContain("no reranking");
    expect(sectionSummary("systemone", { ...input, systemOne: { judging: true, citations: false, citationMode: "annotate", scope: false } })).toBe(
      "Platform defaults: judging on, citations off, scope off",
    );
  });

  it("never says Draft saved while a field can't be saved, and says why Publish is off", () => {
    expect(saveView("saved", false).text).toBe("Draft saved");
    // Just opened, nothing edited: nothing was saved, so it says nothing (walkthrough, 2026-10-02).
    expect(saveView("saved", false, false).text).toBe("");
    expect(saveView("dirty", false, true).text).toBe("Unsaved changes");
    expect(saveView("saved", true).text).toBe("Not saved: fix the highlighted field");
    expect(saveView("dirty", true).text).toBe("Not saved: fix the highlighted field");
    const live = { published: version, hasUnpublishedChanges: false };
    expect(publishBlocked({ agent: live, status: "saved", needsFix: false, audience: "team", isManager: true })).toBe("No changes since version 3");
    expect(publishBlocked({ agent: live, status: "dirty", needsFix: false, audience: "team", isManager: true })).toBeUndefined();
    // A field that can't be saved (own-8): Publish would leave that change out.
    expect(publishBlocked({ agent: live, status: "saved", needsFix: true, audience: "team", isManager: true })).toBe("Fix the highlighted field first.");
    expect(publishBlocked({ agent: { ...live, hasUnpublishedChanges: true }, status: "dirty", needsFix: true, audience: "team", isManager: true })).toBe(
      "Fix the highlighted field first.",
    );
    expect(publishBlocked({ agent: { published: null, hasUnpublishedChanges: true }, status: "saved", needsFix: false, audience: "team", isManager: true })).toBeUndefined();
    // The draft's publish problems (draft.* warnings) disable Publish, with how many.
    const fresh = { published: null, hasUnpublishedChanges: true };
    expect(publishBlocked({ agent: fresh, status: "saved", needsFix: false, audience: "team", isManager: true, problems: 1 })).toBe("Fix the problem listed under Build first.");
    expect(publishBlocked({ agent: fresh, status: "saved", needsFix: false, audience: "team", isManager: true, problems: 2 })).toBe("Fix the 2 problems listed under Build first.");
    expect(publishBlocked({ agent: { ...live, hasUnpublishedChanges: true }, status: "saved", needsFix: false, audience: "public", isManager: false })).toMatch(
      /Only team admins and owners can publish to Public/,
    );
  });
});

describe("Build", () => {
  it("shows the sections beside the Test chat, with summaries, and Publish off when nothing changed (Q5)", async () => {
    mockApi(routes(agent()));
    const { container } = renderApp("/teams/registrar/agents/ag1");
    expect(await screen.findByRole("tab", { name: "Build", selected: true }, { timeout: 5000 })).toBeInTheDocument();
    // Versions is in the header's version menu (I6); Evaluations shows while evaluations are on (not here).
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Build", "Appearance", "Share", "Analytics", "Settings"]);
    expect(await screen.findByRole("region", { name: "Try it" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize the test chat" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Model/ })).toHaveTextContent("GPT-OSS 120B (Campus gateway)"));
    expect(screen.getByRole("button", { name: /^Knowledge/ })).toHaveTextContent("Registrar help");
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription("No changes since version 3");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("an invalid value holds the status at 'Not saved' and marks its section (F-26)", async () => {
    mockApi(routes(agent({ hasUnpublishedChanges: true })));
    renderApp("/teams/registrar/agents/ag1");
    await userEvent.click(await screen.findByRole("button", { name: /^Advanced/ }, { timeout: 5000 }));
    const temperature = screen.getByRole("textbox", { name: /Temperature/ });
    await userEvent.type(temperature, "5");
    expect(await screen.findByText("Enter a number from 0 to 2.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Advanced/ }));
    expect(screen.getByRole("button", { name: /^Advanced/ })).toHaveTextContent("Not saved: fix the highlighted field");
    await new Promise((r) => setTimeout(r, 1000));
    expect(screen.queryByText("Draft saved")).toBeNull();
    expect(screen.getAllByText("Not saved: fix the highlighted field").length).toBeGreaterThan(1);
  }, 10_000);

  it("Reasoning effort says why it can't be chosen until the model accepts it", async () => {
    mockApi(routes(agent()));
    const { container } = renderApp("/teams/registrar/agents/ag1");
    await userEvent.click(await screen.findByRole("button", { name: /^Advanced/ }, { timeout: 5000 }));
    const effort = screen.getByRole("combobox", { name: /Reasoning effort/ });
    expect(effort).toBeDisabled();
    expect(effort).toHaveAccessibleDescription(/Low, Medium and High need "Accepts reasoning effort" turned on for .* in Admin → Models/);
    expect(effort).toHaveAccessibleDescription(/Off needs "How to turn thinking off" set for/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Reasoning effort offers Off once the model can turn thinking off, and the levels once it accepts an effort", async () => {
    const ready = { ...models[0]!, supportsThinkingOff: true };
    mockApi(routes(agent(), { "GET /v1/chat-models": () => [ready] }));
    const { container } = renderApp("/teams/registrar/agents/ag1");
    await userEvent.click(await screen.findByRole("button", { name: /^Advanced/ }, { timeout: 5000 }));
    const effort = screen.getByRole("combobox", { name: /Reasoning effort/ });
    expect(effort).toBeEnabled();
    expect(within(effort).getAllByRole("option").map((o) => [o.textContent, (o as HTMLOptionElement).disabled])).toEqual([
      ["Default", false],
      ["Off", false],
      ["Low", true],
      ["Medium", true],
      ["High", true],
    ]);
    expect(effort).not.toHaveAccessibleDescription(/Off needs/);
    await userEvent.selectOptions(effort, "off");
    expect(effort).toHaveValue("off");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("editors can't start a publish to Public and are told why (P-03)", async () => {
    mockApi(routes(agent({ audience: "public", hasUnpublishedChanges: true, draft: { ...config, audience: "public" } }), {}, "editor"));
    renderApp("/teams/registrar/agents/ag1");
    const publish = await screen.findByRole("button", { name: "Publish" }, { timeout: 5000 });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription(/Only team admins and owners can publish to Public/);
    // Said once: no second notice about the audience under the header.
    expect(screen.queryByText(/can change this agent's audience or publish it beyond the team/)).toBeNull();
  });

  it("the publish dialog names the audience (F-15)", async () => {
    mockApi(routes(agent({ hasUnpublishedChanges: true, draft: { ...config, audience: "public" } })));
    renderApp("/teams/registrar/agents/ag1");
    await userEvent.click(await screen.findByRole("button", { name: "Publish" }, { timeout: 5000 }));
    const dialog = await screen.findByRole("dialog", { name: /Publish version 4/ });
    expect(dialog).toHaveTextContent("Anyone, without signing in, will chat with this configuration");
  });

  it("below 1100 px the Test chat is a drawer opened from the header, kept in ?test=open", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    mockApi(routes(agent()));
    const { router } = renderApp("/teams/registrar/agents/ag1");
    await screen.findByRole("button", { name: /^Instructions/ }, { timeout: 5000 });
    expect(screen.queryByRole("region", { name: "Try it" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try it" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ test: "open" }));
    const drawer = await screen.findByRole("dialog", { name: "Try the draft" });
    expect(await within(drawer).findByRole("textbox", { name: "Message Helper" })).toBeInTheDocument();
  });

  it("results per search inherit the knowledge base's until overridden, and back (C14)", async () => {
    const draft = { ...config, kbs: [{ kbId: "kb1", topK: null }] };
    const calls = mockApi(
      routes(agent({ hasUnpublishedChanges: true, draft }), {
        "PATCH /v1/teams/registrar/agents/ag1": (b) => agent({ revision: 3, hasUnpublishedChanges: true, draft: { ...draft, ...(b as { config: object }).config } }),
      }),
    );
    const { container } = renderApp("/teams/registrar/agents/ag1");
    await userEvent.click(await screen.findByRole("button", { name: /^Knowledge/ }, { timeout: 5000 }));
    expect(await screen.findByText(/Inherited from the knowledge base \(8\)/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Override results per search from Registrar help" }));
    const input = screen.getByRole("spinbutton", { name: "Results per search from Registrar help" });
    expect(input).toHaveValue(8);
    expect(input).toHaveFocus();
    expect(screen.getByText(/Overridden/)).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true), { timeout: 3000 });
    expect((calls.find((c) => c.method === "PATCH")!.body as { config: { kbs: unknown } }).config.kbs).toEqual([{ kbId: "kb1", topK: 8 }]);
    // Out of range: the field says why (aria-describedby), and the button's name starts with its visible text (WCAG 2.5.3).
    await userEvent.clear(input);
    await userEvent.type(input, "25");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a whole number from 1 to 20.");
    expect(screen.getByRole("button", { name: "Inherit (8) from Registrar help" })).toHaveTextContent("Inherit (8)");
    await userEvent.click(screen.getByRole("button", { name: "Inherit (8) from Registrar help" }));
    expect(screen.getByRole("button", { name: "Override results per search from Registrar help" })).toHaveFocus();
    await waitFor(() => expect((calls.filter((c) => c.method === "PATCH").at(-1)!.body as { config: { kbs: unknown } }).config.kbs).toEqual([{ kbId: "kb1", topK: null }]), {
      timeout: 3000,
    });
  }, 15_000);

  it("Settings has the name, address and description, saved like the rest, and a Danger zone (C13)", async () => {
    const calls = mockApi(routes(agent(), { "PATCH /v1/teams/registrar/agents/ag1": (b) => agent({ revision: 3, ...(b as object) }) }));
    const { container } = renderApp("/teams/registrar/agents/ag1?tab=settings");
    const name = await screen.findByRole("textbox", { name: "Name" }, { timeout: 5000 });
    expect(name).toHaveValue("Helper");
    expect(screen.getByRole("textbox", { name: /^Address/ })).toHaveValue("helper");
    expect(screen.getByRole("textbox", { name: /^Description/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Danger zone" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.type(name, " desk");
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true), { timeout: 3000 });
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ name: "Helper desk" });
    await userEvent.click(screen.getByRole("button", { name: "Disable agent" }));
    expect(await screen.findByRole("dialog", { name: "Disable Helper desk?" })).toBeInTheDocument();
  }, 10_000);

  it("Settings says Live only for a published agent, and a tab change drops what was open on the last tab (C13)", async () => {
    mockApi(routes(agent({ published: null, hasUnpublishedChanges: true }), {}));
    const { router } = renderApp("/teams/registrar/agents/ag1?tab=appearance&record=x&form=new");
    await userEvent.click(await screen.findByRole("tab", { name: "Settings" }, { timeout: 5000 }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: "settings" }));
    expect(await screen.findByText(/Nobody can chat with this agent until it's published/)).toBeInTheDocument();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("Appearance keeps the look and welcome only; editors see why they can't disable or delete (C13)", async () => {
    mockApi(routes(agent(), {}, "editor"));
    renderApp("/teams/registrar/agents/ag1?tab=appearance");
    expect(await screen.findByRole("textbox", { name: "Accent colour" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(await screen.findByRole("button", { name: "Delete agent" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disable agent" })).toBeDisabled();
    expect(screen.getAllByText("Only team admins and owners can do this.")).toHaveLength(2);
  });

  it("old Configure links open Build", async () => {
    mockApi(routes(agent()));
    const { router } = renderApp("/teams/registrar/agents/ag1?tab=configure");
    expect(await screen.findByRole("tab", { name: "Build", selected: true }, { timeout: 5000 })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({});
  });

  it("the version history compares a version with the draft by setting name, SystemOne checks included, and has no second Publish", async () => {
    const draft = { ...config, instructions: "Help students briefly.", temperature: 0.2, systemOne: { citations: "on" as const, scope: "on" as const } };
    mockApi(
      routes(agent({ hasUnpublishedChanges: true, draft }), {
        "GET /v1/teams/registrar/agents/ag1/versions/3": () => version,
      }),
    );
    const { container } = renderApp("/teams/registrar/agents/ag1?history=versions");
    await screen.findByRole("table", { name: "Published versions" }, { timeout: 5000 });
    // A record page over the editor: Publish stays the editor's, not repeated here.
    expect(screen.queryAllByRole("button", { name: /Publish/ })).toHaveLength(0);
    const text = await screen.findByRole("table", { name: "Instructions: version 3 and the draft" });
    expect(text).toHaveTextContent("Help students with registration.");
    expect(text).toHaveTextContent("Help students briefly.");
    // The settings that changed, by the Build tab's names (no field paths or IDs), SystemOne checks included.
    const settings = screen.getByRole("table", { name: "Settings that changed from version 3 to the draft" });
    expect(within(settings).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Setting", "Version 3 (live)", "Draft"]);
    const rows = within(settings).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0]!.textContent);
    expect(rows).toEqual(["Temperature", "SystemOne checks"]);
    expect(within(settings).getByRole("row", { name: /SystemOne checks/ })).toHaveTextContent("Platform defaultsCitation checks on · Scope check on");
    // The page says what Compare is once, not again on its card.
    expect(screen.getAllByText("The published versions of Helper. The draft has unpublished changes.")).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Share says a live public agent's links all work signed out, and hides the widget for other audiences", async () => {
    const sharing = (audience: Schemas["Audience"]): Schemas["AgentSharing"] => ({
      agentId: "ag1", audience, draftAudience: audience, shortName: null, publicAgentsEnabled: true, classification: "open", maxAudience: "public",
      options: [{ audience: "team", allowed: true, reasons: [] }, { audience: "all_authenticated", allowed: true, reasons: [] }, { audience: "public", allowed: true, reasons: [] }],
      links: { team: "https://rag.example.edu/a/registrar/helper", id: "https://rag.example.edu/a/id/ag1", short: null },
      widget: { scriptUrl: "https://rag.example.edu/widget.js", integrity: "", maxMessageChars: 2000 },
    });
    mockApi(routes(agent({ audience: "public", draft: { ...config, audience: "public" } }), { "GET /v1/teams/registrar/agents/ag1/sharing": () => sharing("public"), "GET /v1/teams/registrar/agents/ag1/publishable-keys": () => [] }));
    const v = renderApp("/teams/registrar/agents/ag1?tab=share");
    expect(await screen.findByText("All three work without signing in.", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Embed code" })).toBeInTheDocument();
    v.unmount();
    mockApi(routes(agent(), { "GET /v1/teams/registrar/agents/ag1/sharing": () => sharing("team") }));
    renderApp("/teams/registrar/agents/ag1?tab=share");
    expect(await screen.findByText(/People sign in first, and only team members can chat/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Embed code" })).toBeNull();
  });
});

