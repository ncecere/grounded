/* v0.4.2 M2: the agent editor's fixes (BU-05, BU-09, BU-13, AD-02, AD-23, VI-07). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { capabilityLabels, modelOptions } from "../pages/agents/build/model-section";
import { defaultChatModel } from "../pages/agents/common";
import { same } from "../pages/agents/conflict";
import { liveProfileLocked, saveView } from "../pages/agents/publish-state";
import { type Handler, meFor, mockApi, renderApp, shellRoutes } from "./harness";

const config: Schemas["AgentConfig"] = {
  instructions: "Help students with registration.", chatModelId: "mod1", kbs: [{ kbId: "kb1", topK: 6 }], retrievalMode: "always", maxTurns: 4,
  contextTokenBudget: 6000, minSimilarity: 0, strictlyGrounded: true, refusalMessage: "No.", citationMode: "snippet_link", queryRewrite: true,
  moderation: { categories: {}, outputMode: "" }, audience: "team",
};

const agent = (extra: Partial<Schemas["Agent"]> = {}): Schemas["Agent"] => ({
  id: "ag1", teamId: "t1", teamSlug: "registrar", slug: "helper", name: "Helper", description: "", accentColor: "", welcomeMessage: "Hi.", starterQuestions: [],
  status: "active", disabledReason: "", disabledAt: null, audience: "team", draft: config, draftRevision: 1, published: null, hasUnpublishedChanges: true,
  warnings: [], revision: 2, createdAt: "2026-09-26T09:00:00Z", updatedAt: "2026-09-26T10:00:00Z", ...extra,
});

type Model = Schemas["ChatModelOption"];
const model = (id: string, name: string, status: Model["health"]["status"]): Model => ({
  id, key: id, displayName: name, description: "", maxClassification: "sensitive", supportsTools: true, supportsReasoningEffort: false, supportsThinkingOff: false,
  health: { status, ...(status === "untested" ? {} : { since: "2026-09-30T10:00:00Z" }) },
});
const kb = { id: "kb1", name: "Registrar help", description: "", embeddingProfileId: "p1", topK: 8, effectiveClassification: "open", sources: [], revision: 1, createdAt: "", updatedAt: "" };

const routes = (current: Schemas["Agent"], extra: Record<string, Handler> = {}, teamRole = "owner"): Record<string, Handler> => ({
  ...shellRoutes("none", teamRole),
  "GET /v1/teams/registrar/agents/ag1": () => current,
  "GET /v1/teams/registrar/agents/ag1/versions": () => [],
  "GET /v1/chat-models": () => [model("mod1", "Campus chat", "healthy")],
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
  it("compares drafts whatever the order of keys, as the server returns its own (BU-05)", () => {
    expect(same({ systemOne: { judging: "on", scope: "on", citations: "on" } }, { systemOne: { judging: "on", citations: "on", scope: "on" } })).toBe(true);
    expect(same({ kbs: [{ kbId: "a" }, { kbId: "b" }] }, { kbs: [{ kbId: "b" }, { kbId: "a" }] })).toBe(false);
  });

  it("says Saved, not Draft saved, for fields that aren't versioned, and locks them for editors of a wider agent (BU-09)", () => {
    expect(saveView("saved", false, true, true).text).toBe("Saved");
    expect(saveView("saved", false, true, false).text).toBe("Draft saved");
    expect(liveProfileLocked({ audience: "public" }, false)).toMatch(/^This agent is live for Public, so only team admins and owners can change what's here/);
    expect(liveProfileLocked({ audience: "all_authenticated" }, false)).toMatch(/live for Signed-in users/);
    expect(liveProfileLocked({ audience: "public" }, true)).toBeUndefined();
    expect(liveProfileLocked({ audience: "team" }, false)).toBeUndefined();
  });

  it("starts a new agent on a healthy model, never a failing one while another exists, and marks failing ones (AD-02)", () => {
    const failing = model("a", "A failing", "failing");
    const untested = model("b", "B untested", "untested");
    const healthy = model("c", "C healthy", "healthy");
    expect(defaultChatModel([failing, untested, healthy])?.id).toBe("c");
    expect(defaultChatModel([failing, untested])?.id).toBe("b");
    expect(defaultChatModel([failing])?.id).toBe("a");
    expect(defaultChatModel([])).toBeUndefined();
    const [opt] = modelOptions([failing], (k) => k);
    expect(opt!.capabilities).toContain("failing");
    expect(opt!.description).toBe("Failing its health checks");
    expect(capabilityLabels.failing).toBe("Failing");
  });
});

describe("agent editor", () => {
  it("the New agent dialog picks the healthy model, not the first by name (AD-02)", async () => {
    mockApi({
      ...shellRoutes("none", "owner"),
      "GET /v1/teams/registrar/agents": () => [],
      "GET /v1/teams/registrar/kbs": () => [kb],
      "GET /v1/chat-models": () => [model("m1", "Alpha (broken)", "failing"), model("m2", "Campus chat", "healthy")],
    });
    const { container } = renderApp("/teams/registrar/agents");
    await userEvent.click((await screen.findAllByRole("button", { name: "New agent" }, { timeout: 5000 }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "New agent" });
    expect(await within(dialog).findByRole("combobox", { name: /Chat model/ })).toHaveTextContent("Campus chat");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("an editor sees a public agent's name and look read-only, with why (BU-09)", async () => {
    const pub = agent({ audience: "public", draft: { ...config, audience: "public" } });
    mockApi(routes(pub, {}, "editor"));
    const { container } = renderApp("/teams/registrar/agents/ag1?tab=settings");
    expect(await screen.findByRole("textbox", { name: "Name" }, { timeout: 5000 })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Address" })).toBeDisabled();
    expect(screen.getByText(/This agent is live for Public/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(await screen.findByRole("textbox", { name: /Welcome message/ })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Accent colour" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add a question" })).toBeNull();
  });

  it("an invalid accent colour is said once and doesn't block Publish: Appearance isn't versioned (BU-13)", async () => {
    mockApi(routes(agent(), { "PATCH /v1/teams/registrar/agents/ag1": () => agent() }));
    renderApp("/teams/registrar/agents/ag1?tab=appearance");
    const accent = await screen.findByRole("textbox", { name: "Accent colour" }, { timeout: 5000 });
    await userEvent.type(accent, "#12");
    expect(await screen.findAllByText("Enter a hex colour such as #4b4fd6.", { exact: false })).toHaveLength(1);
    expect(accent).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByText("Not saved: fix the highlighted field")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Publish/ })).toBeEnabled();
  });

  it("the agent's Evaluations tab doesn't repeat New set in its empty state (VI-07)", async () => {
    const me = meFor("none", "owner");
    mockApi(
      routes(agent(), {
        "GET /v1/me": () => ({ ...me, capabilities: { ...me.capabilities, evaluations: true } }),
        "GET /v1/teams/registrar/evaluation-sets": () => [],
      }),
    );
    renderApp("/teams/registrar/agents/ag1?tab=evaluations");
    expect(await screen.findByText("No evaluation sets yet.", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /New set/ })).toHaveLength(1);
    expect(screen.getByText(/Create one with New set above\./)).toBeInTheDocument();
  });
});
