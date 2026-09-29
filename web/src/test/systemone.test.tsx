import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { judgedSummary, settingsChanges, settingsForm, settingsInput, settingsProblems } from "../lib/systemone";
import { applyChatEvent, pendingAssistant, type ChatItem } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { TeamContext, teamCtx } from "../pages/team/common";
import { RetrievePlayground } from "../pages/team/retrieve";
import { mockApi, renderApp, renderBare, shellRoutes, team } from "./harness";

/* SystemOne (ADR-0020, docs/systemone.md): the admin page and its form helpers, the playground's judgments, the chat's "checked, used" line and analytics. */

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const defaults: Schemas["SystemOneSettings"] = {
  modelId: null,
  judging: { enabled: false, candidates: 20, mode: "per_passage", timeoutMs: 5000, thresholds: { injection: 0.7, relevant: 0.45, contradicts: 0.7, evidence: 0.55 } },
  citations: { enabled: false, mode: "annotate", autoAccept: 0.8, timeoutMs: 20000 },
  scope: { enabled: false, smallTalk: 0.5, inScope: 0.2, timeoutMs: 5000 },
  revision: 1,
  updatedAt: null,
};

const judge = {
  id: "s1", connectionId: "c1", key: "openjev", upstreamModel: "openjev-latest", displayName: "OpenJev", description: "", kind: "systemone",
  maxClassification: "sensitive", enabled: true, supportsTools: false, supportsVision: false, compat: {}, moderationProvider: null, moderationFamily: null,
  revision: 1, createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z",
};

describe("admin SystemOne page", () => {
  it("chooses the model, turns judging on and saves with the revision", async () => {
    let saved = defaults;
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/models": () => [judge],
      "GET /v1/admin/systemone": () => saved,
      "PUT /v1/admin/systemone": (body) => (saved = { ...defaults, ...(body as Schemas["SystemOneSettingsInput"]), revision: 2, updatedAt: "2026-09-26T11:00:00Z" }),
    });
    const { container } = renderApp("/admin/systemone");
    const model = await screen.findByRole("combobox", { name: "Model" });
    const toggle = screen.getByRole("switch", { name: /Judge passages for every agent/ });
    expect(toggle.getAttribute("aria-disabled") === "true" || toggle.hasAttribute("data-disabled")).toBe(true); // no model yet
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.selectOptions(model, "s1");
    await userEvent.click(screen.getByRole("switch", { name: /Judge passages for every agent/ }));
    const candidates = screen.getByRole("textbox", { name: "Candidates" });
    await userEvent.clear(candidates);
    await userEvent.type(candidates, "10");
    expect(screen.getByText("3 unsaved changes")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"1"');
    expect(put.body).toEqual({ modelId: "s1", judging: { ...defaults.judging, enabled: true, candidates: 10 }, citations: defaults.citations, scope: defaults.scope });
    expect(await screen.findByText("SystemOne settings saved")).toBeInTheDocument();
  });

  it("explains how to add a SystemOne model when there is none", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/models": () => [], "GET /v1/admin/systemone": () => defaults });
    const { container } = renderApp("/admin/systemone");
    expect(await screen.findByText("No SystemOne model yet.")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("SystemOne settings form", () => {
  it("round-trips, validates and counts changes", () => {
    const f = settingsForm({ ...defaults, modelId: "s1" });
    expect(f.thresholds).toEqual({ injection: "70", relevant: "45", contradicts: "70", evidence: "55" });
    expect(settingsInput(f)).toEqual({ modelId: "s1", judging: defaults.judging, citations: defaults.citations, scope: defaults.scope });
    expect(settingsProblems({ ...f, candidates: "0", timeoutMs: "100", thresholds: { ...f.thresholds, evidence: "120" } })).toEqual({
      candidates: "Enter 1 to 50 candidates.",
      timeoutMs: "Enter a timeout from 500 to 60,000 ms.",
      evidence: "Evidence: enter 0 to 100%.",
    });
    expect(settingsProblems({ ...f, modelId: "", enabled: true }).modelId).toMatch(/Choose a SystemOne model/);
    expect(settingsProblems({ ...f, modelId: "", citations: { ...f.citations, enabled: true } }).modelId).toMatch(/Choose a SystemOne model/);
    expect(settingsChanges({ ...defaults, modelId: "s1" }, { ...f, mode: "batched", thresholds: { ...f.thresholds, relevant: "30" } })).toBe(2);
    expect(judgedSummary({ judged: 20, kept: 5 })).toBe("20 passages checked, 5 used");
    expect(judgedSummary({ judged: 1, kept: 0 })).toBe("1 passage checked, 0 used");
  });
});

const hit = (n: number, route: Schemas["PassageJudgment"]["route"], extra: Partial<Schemas["PassageJudgment"]> = {}): Schemas["RetrieveHit"] => ({
  chunkId: `c${n}`, documentId: `d${n}`, sourceId: "src", content: `Passage ${n}`, headingPath: [], title: `Page ${n}`, filename: "", url: "", score: 0.03 - n / 1000,
  judgment: { relevant: 0.9, evidence: 0.8, contradicts: 0.05, injection: 0.02, route, skipped: false, ...extra },
});

describe("KB playground judging", () => {
  it("judges with SystemOne for editors and shows each passage's scores and route", async () => {
    const calls = mockApi({
      "GET /v1/systemone/status": () => ({ available: true, judging: { enabled: false, candidates: 20 }, citations: { enabled: false, mode: "annotate" }, scope: { enabled: false } }),
      "POST /v1/teams/registrar/kbs/k1/retrieve": () => ({
        latencyMs: 4200,
        judging: { mode: "per_passage", judged: 3, kept: 2, dropped: 1, skipped: 0, requests: 3, latencyMs: 3900 },
        hits: [hit(1, "evidence"), hit(2, "conflicting", { contradicts: 0.93 }), hit(3, "dropped", { injection: 0.97, reason: "injection" })],
      }),
    });
    const ui = (
      <TeamContext.Provider value={teamCtx(team as never, "editor")}>
        <RetrievePlayground kbId="k1" defaultTopK={6} />
      </TeamContext.Provider>
    );
    const { container } = renderBare(ui);
    await userEvent.click(await screen.findByRole("switch", { name: /Judge with SystemOne/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "Question or search terms" }), "transcript fee");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/SystemOne checked 3 passages in 3,900 ms/)).toBeInTheDocument();
    const cards = within(screen.getByRole("list", { name: "Search results" })).getAllByRole("article");
    expect(cards[0]).toHaveTextContent("Evidence");
    expect(cards[1]).toHaveTextContent("Conflicting");
    expect(cards[1]).toHaveTextContent("contradicts 93%");
    expect(cards[2]).toHaveTextContent("dropped: prompt injection");
    expect(calls.at(-1)?.body).toEqual({ query: "transcript fee", judge: true });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("offers no judging without a SystemOne model or to members", async () => {
    mockApi({ "GET /v1/systemone/status": () => ({ available: true, judging: { enabled: false, candidates: 20 }, citations: { enabled: false, mode: "annotate" }, scope: { enabled: false } }) });
    renderBare(
      <TeamContext.Provider value={teamCtx(team as never, "member")}>
        <RetrievePlayground kbId="k1" defaultTopK={6} />
      </TeamContext.Provider>,
    );
    expect(await screen.findByRole("textbox", { name: "Question or search terms" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Judge/ })).toBeNull();
  });
});

describe("chat judging line", () => {
  it("says how many passages were checked and used", async () => {
    let a = pendingAssistant();
    a = applyChatEvent(a, "retrieval", { query: "fees", hits: [{ n: 1, title: "Fees", snippet: "Ten dollars" }], judging: { judged: 20, kept: 5, dropped: 15 } });
    a = applyChatEvent(a, "message_end", { messageId: "m1", stopReason: "stop", text: "Ten dollars [1]", citations: [], refused: false, noContext: false });
    expect(a.steps[0]?.judging).toEqual({ judged: 20, kept: 5, dropped: 15 });
    const items: ChatItem[] = [{ role: "user", key: "u1", text: "Fees?" }, { ...a, status: "done" }];
    const { container } = renderBare(<ChatMessages items={items} agent={{ name: "Helper" }} />);
    expect((await screen.findAllByText("20 passages checked, 5 used")).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
    // Without judging the step still counts results.
    const plain = applyChatEvent(pendingAssistant(), "retrieval", { query: "fees", hits: [{ n: 1, title: "Fees", snippet: "x" }] });
    expect(plain.steps[0]?.judging).toBeUndefined();
  });
});

describe("analytics judging", () => {
  it("shows judging counts and added latency once passages were judged", async () => {
    const totals = {
      answers: 10, conversations: 4, uniqueUsers: 3, up: 1, down: 0, satisfaction: 1, noContextRate: 0.1, refusalRate: 0, errorRate: 0,
      latencyP50Ms: 9000, latencyP95Ms: 15000, firstTokenP50Ms: 8000, moderation: { questionsBlocked: 0, answersWithheld: 0, flagged: 0, supported: 1 },
      judging: { answers: 8, candidates: 160, evidence: 30, conflicting: 2, kept: 32, dropped: { injection: 1, irrelevant: 110, notUsable: 17 }, skipped: 0, judgedOut: 1, requests: 160, latencyP50Ms: 6100, latencyP95Ms: 9800 },
    };
    mockApi({
      ...shellRoutes("platform_auditor"),
      "GET /v1/systemone/status": () => ({ available: true, judging: { enabled: true, candidates: 20 }, citations: { enabled: false, mode: "annotate" }, scope: { enabled: false } }),
      "GET /v1/admin/analytics": () => ({ from: "2026-09-24", to: "2026-09-26", totals, audiences: [], channels: [], moderation: [], models: [], topAgents: [], topTeams: [], daily: [] }),
    });
    const { container } = renderApp("/admin/analytics");
    expect(await screen.findByRole("region", { name: "Moderation" })).toHaveTextContent("Support messages");
    // The SystemOne cards are on the Checks tab (v0.2.1 I8).
    await userEvent.click(await screen.findByRole("tab", { name: "Checks" }));
    const group = await screen.findByRole("region", { name: "Passage judging (SystemOne)" });
    expect(group).toHaveTextContent("160");
    expect(group).toHaveTextContent("1 injection · 110 not relevant · 17 nothing usable · 1 refused without a model call");
    expect(group).toHaveTextContent("6.1 s");
    expect(await axe(container)).toHaveNoViolations();
  });
});
