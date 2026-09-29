import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { settingsChanges, settingsForm, settingsInput, settingsProblems, verificationLabel, worstVerification } from "../lib/systemone";
import { applyChatEvent, pendingAssistant, type ChatItem } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { mockApi, renderApp, renderBare, shellRoutes } from "./harness";

/* SystemOne citation checks and scope check (docs/systemone.md §3-§4): the admin cards, the chat's citation marks and notes, and analytics. */

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const saved: Schemas["SystemOneSettings"] = {
  modelId: "s1",
  judging: { enabled: false, candidates: 10, mode: "per_passage", timeoutMs: 5000, thresholds: { injection: 0.7, relevant: 0.45, contradicts: 0.7, evidence: 0.3 } },
  citations: { enabled: false, mode: "annotate", autoAccept: 0.8, timeoutMs: 20000 },
  scope: { enabled: false, smallTalk: 0.5, inScope: 0.2, timeoutMs: 5000 },
  revision: 3,
  updatedAt: "2026-09-26T10:00:00Z",
};

const judge = {
  id: "s1", connectionId: "c1", key: "openjev", upstreamModel: "openjev-latest", displayName: "OpenJev", description: "", kind: "systemone",
  maxClassification: "sensitive", enabled: true, supportsTools: false, supportsVision: false, compat: {}, moderationProvider: null, moderationFamily: null,
  revision: 1, createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z",
};

describe("admin SystemOne checks", () => {
  it("turns citation checks (enforce) and the scope check on and saves them", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/models": () => [judge],
      "GET /v1/admin/systemone": () => saved,
      "PUT /v1/admin/systemone": (body) => ({ ...saved, ...(body as object), revision: 4 }),
    });
    const { container } = renderApp("/admin/systemone");
    await userEvent.click(await screen.findByRole("switch", { name: /Check citations for every agent/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Enforce/ }));
    await userEvent.click(screen.getByRole("switch", { name: /Check the scope for every agent/ }));
    const inScope = screen.getByRole("textbox", { name: "In scope (%)" });
    await userEvent.clear(inScope);
    await userEvent.type(inScope, "30");
    expect(screen.getByText("4 unsaved changes")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const body = calls.find((c) => c.method === "PUT")!.body as Schemas["SystemOneSettingsInput"];
    expect(body.citations).toEqual({ enabled: true, mode: "enforce", autoAccept: 0.8, timeoutMs: 20000 });
    expect(body.scope).toEqual({ enabled: true, smallTalk: 0.5, inScope: 0.3, timeoutMs: 5000 });
  });

  it("validates the check settings", () => {
    const f = settingsForm(saved);
    expect(settingsInput(f).citations).toEqual(saved.citations);
    const bad = { ...f, citations: { ...f.citations, autoAccept: "120", timeoutMs: "1" }, scope: { ...f.scope, inScope: "x", timeoutMs: "99999" } };
    expect(Object.keys(settingsProblems(bad)).sort()).toEqual(["autoAccept", "citationTimeoutMs", "inScope", "scopeTimeoutMs"]);
    expect(settingsChanges(saved, { ...f, scope: { ...f.scope, enabled: true } })).toBe(1);
  });
});

const cite = (n: number, extra: Partial<Schemas["Citation"]> = {}): Schemas["Citation"] => ({
  n, documentId: `d${n}`, sourceId: "s", title: `Page ${n}`, snippet: `Snippet ${n}`, headingPath: [], ...extra,
});

describe("chat citation checks", () => {
  it("applies citations_checked in place: a check on verified citations, a warning with an explanation on the others", async () => {
    let a = pendingAssistant();
    a = applyChatEvent(a, "message_end", { messageId: "m1", stopReason: "stop", text: "Ten dollars [1]. Same day [2].", citations: [cite(1), cite(2)], refused: false, noContext: false });
    expect(a.ended).toBe(true);
    a = applyChatEvent(a, "citations_checked", {
      messageId: "m1", text: "Ten dollars [1]. Same day [2].", refused: false, verified: 1, unsupported: 1, unchecked: 0,
      citations: [cite(1, { verification: "verified", confidence: 0.97 }), cite(2, { verification: "unsupported", confidence: 0.92 })],
    });
    a = applyChatEvent(a, "done", {});
    const items: ChatItem[] = [{ role: "user", key: "u1", text: "Fees?" }, a];
    const { container } = renderBare(<ChatMessages items={items} agent={{ name: "Helper" }} />);
    const ok = await screen.findByRole("button", { name: "Source 1: Page 1. Verified: the source supports this (97% confidence)" });
    const warn = screen.getByRole("button", { name: "Source 2: Page 2. Not supported by this source (92% confidence)" });
    expect(ok).toHaveAttribute("data-verification", "verified");
    expect(warn).toHaveAttribute("data-verification", "unsupported");
    expect(within(screen.getByRole("list", { name: "Sources for this answer" })).getByText(/Not supported by this source \(92% confidence\)/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("enforce replaces the text or refuses; unchecked citations get no mark", () => {
    let a = applyChatEvent(pendingAssistant(), "message_end", { messageId: "m1", stopReason: "stop", text: "A [1]. B [2].", citations: [cite(1), cite(2)] });
    a = applyChatEvent(a, "citations_checked", { text: "A [1]. B.", citations: [cite(1, { verification: "unchecked" })], refused: false });
    expect(a.text).toBe("A [1]. B.");
    expect(worstVerification(a.citations.map((c) => c.verification))).toBeUndefined();
    a = applyChatEvent(a, "citations_checked", { text: "No answer.", citations: [], refused: true });
    expect(a.refused).toBe(true);
    expect(worstVerification(["verified", "contradicted", "unsupported"])).toBe("contradicted");
    expect(verificationLabel("contradicted", 0.5)).toBe("Contradicted by this source (50% confidence)");
  });

  it("an out-of-scope refusal says so in its text, adds no warning to small talk, and offers the starter questions", async () => {
    const end = (reason: string, refused: boolean, text: string) =>
      applyChatEvent(applyChatEvent(pendingAssistant(), "message_end", { messageId: "m", stopReason: "stop", text, citations: [], refused, noContext: true, noContextReason: reason }), "done", {});
    const items: ChatItem[] = [
      { role: "user", key: "u1", text: "Hi" },
      end("small_talk", false, "Hello!"),
      { role: "user", key: "u2", text: "Pizza?" },
      end("out_of_scope", true, "This is outside what Helper covers."),
    ];
    const asked: string[] = [];
    const { container } = renderBare(<ChatMessages items={items} agent={{ name: "Helper", starterQuestions: ["How much is a transcript?"] }} onStarter={(q) => asked.push(q)} />);
    expect(await screen.findByText("This is outside what Helper covers.")).toBeInTheDocument();
    // The text says it: no note that contradicts it, and nothing about searching.
    expect(screen.queryByText(/searched its sources/)).toBeNull();
    expect(screen.queryByText(/No matching sources were found/)).toBeNull();
    const offer = screen.getByRole("group", { name: "You can ask" });
    await userEvent.click(within(offer).getByRole("button", { name: "How much is a transcript?" }));
    expect(asked).toEqual(["How much is a transcript?"]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a refusal after a search says it searched, then offers the starter questions (last answer only)", async () => {
    const refusal = () => applyChatEvent(applyChatEvent(pendingAssistant(), "message_end", { messageId: "m", stopReason: "stop", text: "I couldn't find that.", citations: [], refused: true, noContext: true }), "done", {});
    const items: ChatItem[] = [{ role: "user", key: "u1", text: "Fee?" }, refusal(), { role: "user", key: "u2", text: "Fee again?" }, refusal()];
    renderBare(<ChatMessages items={items} agent={{ name: "Helper", starterQuestions: ["How much is a transcript?"] }} onStarter={() => {}} />);
    expect(await screen.findAllByText("The agent searched its sources and found nothing that answers this.")).toHaveLength(2);
    expect(screen.getAllByRole("group", { name: "You can ask" })).toHaveLength(1);
  });
});

describe("analytics citation checks and scope", () => {
  it("shows the support rate and scope decisions once anything was checked", async () => {
    const zeroJudging = { answers: 0, candidates: 0, evidence: 0, conflicting: 0, kept: 0, dropped: { injection: 0, irrelevant: 0, notUsable: 0 }, skipped: 0, judgedOut: 0, requests: 0, latencyP50Ms: null, latencyP95Ms: null };
    const totals = {
      answers: 10, conversations: 4, uniqueUsers: 3, up: 1, down: 0, satisfaction: 1, noContextRate: 0.1, refusalRate: 0, errorRate: 0,
      latencyP50Ms: 3000, latencyP95Ms: 5000, firstTokenP50Ms: 800, moderation: { questionsBlocked: 0, answersWithheld: 0, flagged: 0, supported: 0 }, judging: zeroJudging,
      citations: { answers: 8, pairs: 30, verified: 24, unsupported: 4, contradicted: 1, unchecked: 1, lowConfidence: 2, removed: 0, refused: 0, supportRate: 24 / 29, latencyP50Ms: 1900, latencyP95Ms: 3500 },
      scope: { checked: 10, smallTalk: 2, outOfScope: 1, refused: 1, skipped: 0, latencyP50Ms: 420 },
    };
    mockApi({
      ...shellRoutes("platform_auditor"),
      "GET /v1/systemone/status": () => ({ available: true, judging: { enabled: false, candidates: 10 }, citations: { enabled: true, mode: "annotate" }, scope: { enabled: true } }),
      "GET /v1/admin/analytics": () => ({ from: "2026-09-24", to: "2026-09-26", totals, audiences: [], channels: [], moderation: [], models: [], topAgents: [], topTeams: [], daily: [] }),
    });
    // On the Checks tab (v0.2.1 I8).
    const { container } = renderApp("/admin/analytics?tab=checks");
    const cites = await screen.findByRole("region", { name: "Citation checks (SystemOne)" });
    expect(cites).toHaveTextContent("82.8%");
    expect(cites).toHaveTextContent("4 unsupported · 1 contradicted · 2 low confidence (review)");
    const scope = screen.getByRole("region", { name: "Scope check (SystemOne)" });
    expect(scope).toHaveTextContent("1 refused without a search or model call");
    expect(screen.queryByRole("region", { name: "Passage judging (SystemOne)" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
