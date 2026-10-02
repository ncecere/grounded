import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { cleanOverride, parseThreshold } from "../lib/moderation";
import { changedCount, formProblems, policyForm, policyInput } from "../pages/admin/moderation/policy-form";
import { applyChatEvent, historyOf, itemsFromConversation, pendingAssistant, type ChatItem } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { mockApi, renderApp, renderBare, shellRoutes } from "./harness";

/* Moderation (docs/phase4-publishing.md §4, §10): the admin page, its form helpers, and the chat's moderation event. */

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const cats = ["violence", "self_harm", "sexual", "sexual_minors", "harassment_hate", "illicit", "personal_data", "prompt_injection"] as const;
const policy = (audience: Schemas["Audience"], extra: Partial<Schemas["ModerationPolicy"]> = {}): Schemas["ModerationPolicy"] => {
  const action = audience === "public" ? "block" : "off";
  const categories = Object.fromEntries(cats.map((c) => [c, { input: { action, threshold: 0.5 }, output: { action, threshold: 0.5 } }])) as Schemas["ModerationPolicy"]["categories"];
  return {
    audience, modelId: null, categories, outputMode: audience === "public" ? "stream_checked" : "stream_retract", failClosed: audience === "public",
    notice: "This message can't be answered because it may break the usage policy.", severityBlock: null, supportMessage: "Please reach out for support.", uncalibratedBlockThreshold: 0.95,
    reasoningEffort: audience === "public" ? "low" : "default", revision: 1, updatedAt: null, ...extra,
  };
};

const classifier = {
  id: "m9", connectionId: "c1", key: "mod-classifier", upstreamModel: "gpt-oss-20b", displayName: "Classifier", description: "", kind: "moderation",
  maxClassification: "sensitive", enabled: true, supportsTools: false, supportsVision: false, compat: {}, moderationProvider: "chat_classifier", moderationFamily: null,
  revision: 1, createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z",
};

const result = (violence: number): Schemas["ModerationResult"] => ({
  provider: "chat_classifier", calibrated: false, latencyMs: 812,
  scores: cats.map((c) => ({ category: c, probability: c === "violence" ? violence : 0.02, supported: c !== "prompt_injection" })),
});

describe("moderation with a SystemOne model", () => {
  it("lists SystemOne models as providers and edits severity, support and the support action", async () => {
    const judge = { ...classifier, id: "s1", key: "openjev", displayName: "OpenJev", kind: "systemone", moderationProvider: null };
    let team = policy("team", { modelId: "s1" });
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/models": () => [classifier, judge],
      "GET /v1/admin/moderation/policies/team": () => team,
      "GET /v1/admin/moderation/policies/all_authenticated": () => policy("all_authenticated"),
      "GET /v1/admin/moderation/policies/public": () => policy("public"),
      "PUT /v1/admin/moderation/policies/team": (body) => (team = { ...team, ...(body as object), revision: 2 }),
    });
    const { container } = renderApp("/admin/moderation");
    // Audience tabs come first (Q8); Providers is the last tab.
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((x) => x.textContent)).toEqual(["Team", "Signed-in users", "Public", "Providers"]);
    expect(await screen.findByText(/Provider: OpenJev · Streams, then retracts · Fails open · 0 categories blocking/)).toBeInTheDocument();
    // Thresholds only show when the action isn't Off.
    expect(screen.queryByRole("textbox", { name: "Violence, questions: threshold (%)" })).toBeNull();
    const severity = await screen.findByRole("combobox", { name: "Block by severity" });
    expect(screen.getByText(/Blocks questions and answers at or above this severity/)).toBeInTheDocument();
    await userEvent.selectOptions(severity, "2");
    const selfHarm = screen.getByRole("combobox", { name: "Self-harm, questions: action" });
    expect(within(selfHarm).getByRole("option", { name: "Support" })).toBeInTheDocument();
    expect(within(screen.getByRole("combobox", { name: "Violence, questions: action" })).queryByRole("option", { name: "Support" })).toBeNull();
    await userEvent.selectOptions(selfHarm, "support");
    const message = screen.getByRole("textbox", { name: "Support message" });
    await userEvent.clear(message);
    await userEvent.type(message, "You are not alone. Call your local crisis line.");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Save policy" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const body = calls.find((c) => c.method === "PUT")!.body as Schemas["ModerationPolicyInput"];
    expect(body.severityBlock).toBe(2);
    expect(body.supportMessage).toBe("You are not alone. Call your local crisis line.");
    expect(body.categories.self_harm?.input.action).toBe("support");
  });
});

describe("admin moderation page", () => {
  it("lists providers, saves the public policy with its revision and runs the test box", async () => {
    let pub = policy("public");
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/models": () => [classifier],
      "GET /v1/admin/moderation/policies/team": () => policy("team", { modelId: "m9" }),
      "GET /v1/admin/moderation/policies/all_authenticated": () => policy("all_authenticated"),
      "GET /v1/admin/moderation/policies/public": () => pub,
      "PUT /v1/admin/moderation/policies/public": (body) => (pub = { ...pub, ...(body as object), revision: 2, updatedAt: "2026-09-26T11:00:00Z" }),
      "POST /v1/admin/moderation/test": () => result(0.97),
    });
    const { container } = renderApp("/admin/moderation?tab=public");
    expect(await screen.findByText("Public agents can't be published yet")).toBeInTheDocument();
    // m9: without a provider, the behaviour settings have no effect and aren't shown.
    expect(screen.queryByRole("switch", { name: /Fail closed/ })).toBeNull();
    expect(screen.getByText(/Moderation is off for this audience/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "m9");
    const failClosed = screen.getByRole("switch", { name: /Fail closed/ });
    expect(failClosed).toBeChecked();
    expect(failClosed.getAttribute("aria-disabled") === "true" || failClosed.hasAttribute("data-disabled")).toBe(true);
    // Three output modes; the Public default streams checked paragraphs.
    const modes = screen.getByRole("radiogroup", { name: "Answers" });
    expect(within(modes).getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual(["Stream, then retract", "Stream checked paragraphs", "Buffer"]);
    expect(within(modes).getByRole("radio", { name: /Stream checked paragraphs/ })).toBeChecked();
    expect(screen.getByText(/Provider: Classifier · Streams checked paragraphs · Fails closed/)).toBeInTheDocument();
    const threshold = screen.getByRole("textbox", { name: "Violence, questions: threshold (%)" });
    await userEvent.clear(threshold);
    await userEvent.type(threshold, "30");
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();
    // The audience's reasoning effort: Public uses Low until an admin chooses (owner decision, 2026-10-01).
    const effort = screen.getByRole("combobox", { name: "Reasoning effort" });
    expect(effort).toHaveValue("low");
    expect(within(effort).getAllByRole("option").map((o) => o.textContent)).toEqual(["Model default", "Off", "Low", "Medium", "High"]);
    await userEvent.selectOptions(effort, "off");
    expect(screen.getByText("3 unsaved changes")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save policy" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"1"');
    const body = put.body as Schemas["ModerationPolicyInput"];
    expect(body.modelId).toBe("m9");
    expect(body.failClosed).toBe(true);
    expect(body.reasoningEffort).toBe("off");
    expect(body.categories.violence).toEqual({ input: { action: "block", threshold: 0.3 }, output: { action: "block", threshold: 0.5 } });
    expect(await screen.findByText("Moderation policy saved")).toBeInTheDocument();

    // The test sheet judges against the open tab's policy.
    await userEvent.click(screen.getByRole("button", { name: "Test a provider" }));
    const sheet = await screen.findByRole("dialog", { name: "Test a provider" });
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Text" }), "How do I hurt someone?");
    await userEvent.click(within(sheet).getByRole("button", { name: "Run test" }));
    const scores = await within(sheet).findByRole("table", { name: "Scores for the test text" });
    expect(within(sheet).getByText("Public policy: Blocked (Violence)")).toBeInTheDocument();
    expect(within(scores).getByText("97%")).toBeInTheDocument();
    expect(within(scores).getByText("Not supported by this provider")).toBeInTheDocument();
    expect(screen.getByText("Not calibrated")).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/v1/admin/moderation/test")?.body).toEqual({ modelId: "m9", text: "How do I hurt someone?", stage: "input" });
  });

  it("lists providers with what uses them in the Providers tab", async () => {
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/models": () => [{ ...classifier, moderationTimeoutSeconds: 30 }],
      "GET /v1/admin/moderation/policies/team": () => policy("team", { modelId: "m9" }),
      "GET /v1/admin/moderation/policies/all_authenticated": () => policy("all_authenticated"),
      "GET /v1/admin/moderation/policies/public": () => policy("public"),
    });
    const { container } = renderApp("/admin/moderation?tab=providers");
    const providers = await screen.findByRole("table", { name: "Moderation providers" });
    expect(await within(providers).findByText("Chat model as classifier")).toBeInTheDocument();
    expect(await within(providers).findByText("Team")).toBeInTheDocument(); // used by the team policy
    expect(within(providers).getByText("Not calibrated")).toBeInTheDocument();
    expect(await within(providers).findByText("30 s")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is read-only for auditors", async () => {
    mockApi({
      ...shellRoutes("platform_auditor"),
      "GET /v1/admin/models": () => [classifier],
      "GET /v1/admin/moderation/policies/team": () => policy("team"),
      "GET /v1/admin/moderation/policies/all_authenticated": () => policy("all_authenticated"),
      "GET /v1/admin/moderation/policies/public": () => policy("public"),
    });
    renderApp("/admin/moderation?tab=public");
    // The public policy has rules on (no provider yet): they stay visible so they can be turned off.
    expect(await screen.findByRole("table", { name: "Category rules" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Save policy|Run test/ })).toBeNull();
  });
});

describe("moderation form helpers", () => {
  it("round-trips a policy and reports problems", () => {
    const f = policyForm(policy("team"));
    expect(policyInput(f).categories.violence).toEqual({ input: { action: "off", threshold: 0.5 }, output: { action: "off", threshold: 0.5 } });
    expect(changedCount(policy("team"), f)).toBe(0);
    f.rules.violence.input = { action: "block", threshold: "120" };
    expect(formProblems(f)).toEqual({ "violence.input": "Violence: enter a threshold from 0 to 100%.", modelId: "Choose a provider, or turn every category off." });
    f.rules.violence.input.threshold = "40";
    f.modelId = "m9";
    expect(formProblems(f)).toEqual({});
    expect(changedCount(policy("team"), f)).toBe(2);
    expect(policyInput(f)).toMatchObject({ modelId: "m9", categories: { violence: { input: { action: "block", threshold: 0.4 } } } });
  });

  it("parses thresholds and cleans overrides", () => {
    expect([parseThreshold("50"), parseThreshold("7%"), parseThreshold(""), parseThreshold("101"), parseThreshold("x")]).toEqual([0.5, 0.07, undefined, undefined, undefined]);
    const off = { action: "off" as const, threshold: 0.5 };
    expect(cleanOverride({ categories: { sexual: { input: off, output: off }, illicit: { input: { action: "flag", threshold: 0.2 }, output: off } }, outputMode: "" })).toEqual({
      categories: { illicit: { input: { action: "flag", threshold: 0.2 }, output: off } },
      outputMode: "",
    });
    expect(cleanOverride({ categories: {}, outputMode: "stream_checked" }).outputMode).toBe("stream_checked");
  });
});

describe("the moderation event in chat", () => {
  it("retracts a streamed answer, and buffers until the answer arrives", () => {
    let a = applyChatEvent(pendingAssistant(), "message_start", { messageId: "m1" });
    a = applyChatEvent(a, "thinking_delta", { delta: "Hmm" });
    a = applyChatEvent(a, "text_delta", { delta: "Something harmful" });
    a = applyChatEvent(a, "moderation", { stage: "output", action: "retracted", category: "violence", notice: "Withheld." });
    a = applyChatEvent(a, "text_delta", { delta: " more" });
    a = applyChatEvent(a, "message_end", { messageId: "m1", stopReason: "stop", text: "Withheld.", citations: [{ n: 1 }] });
    expect(a).toMatchObject({ text: "Withheld.", thinking: "", citations: [], moderation: { stage: "output", action: "retracted", notice: "Withheld." } });
    expect(applyChatEvent(pendingAssistant(), "message_start", { messageId: "m2", buffered: true }).buffered).toBe(true);
  });

  it("restores stored notices and leaves moderated turns out of the history", () => {
    const items = itemsFromConversation([
      { id: "u1", seq: 1, role: "user", text: "bad question", createdAt: "" },
      { id: "a1", seq: 2, role: "assistant", text: "Blocked.", errorCode: "moderation_blocked", stopReason: "stop", createdAt: "" },
      { id: "u2", seq: 3, role: "user", text: "good question", createdAt: "" },
      { id: "a2", seq: 4, role: "assistant", text: "An answer.", stopReason: "stop", createdAt: "" },
    ]);
    expect(items[1]).toMatchObject({ status: "done", moderation: { stage: "input", action: "blocked", notice: "Blocked." } });
    expect((items[1] as { error?: unknown }).error).toBeUndefined();
    expect(historyOf(items)).toEqual([
      { role: "user", content: "good question" },
      { role: "assistant", content: "An answer." },
    ]);
  });

  it("shows the notice as an alert (not an answer) and “Writing and checking the answer…” while an answer is buffered", async () => {
    const buffered = { ...pendingAssistant(), key: "a1", buffered: true };
    const moderated = { ...pendingAssistant(), key: "a2", status: "done" as const, text: "Withheld.", moderation: { stage: "input" as const, action: "blocked" as const, notice: "Withheld." } };
    const items: ChatItem[] = [{ role: "user", key: "u1", text: "Hi" }, buffered, { role: "user", key: "u2", text: "Bad" }, moderated];
    const { container } = renderBare(<ChatMessages items={items} agent={{ name: "Helper" }} />);
    expect(await screen.findByText("Writing and checking the answer…")).toBeInTheDocument();
    const notice = screen.getAllByRole("status").find((el) => el.textContent?.includes("Withheld."));
    expect(notice).toHaveTextContent("Not answered");
    // No copy or rating buttons on a notice (F-10).
    expect(screen.queryByRole("button", { name: "Copy answer" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
