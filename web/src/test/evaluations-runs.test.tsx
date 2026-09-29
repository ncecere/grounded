/* Evaluation runs (A2, docs/evaluations.md §2-§4): the Runs tab with the score chart, a run's record page (results, cancel, compare), the run dialog, "Add to evaluations", the admin switch, and the pure helpers. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { ChatMessages, needsEvaluation } from "../pages/chat/thread";
import type { AssistantItem, ChatItem } from "../pages/chat/stream";
import { configChanges, expectedList, importFormat, missingText, pct, scoreSeries, splitExpected } from "../pages/team/evaluations/labels";
import { answerEstimate } from "../pages/team/evaluations/run-dialog";
import { mockApi, renderApp, renderBare, shellRoutes } from "./harness";
import { evalRoutes, meWithEvals, questions, result, run, runs, set } from "./evaluations-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const T = { timeout: 5000 };

describe("pure helpers", () => {
  it("formats scores and says what changed between runs", () => {
    expect(pct(0.834)).toBe("83%");
    expect(pct(undefined)).toBe("—");
    expect(missingText({ missing: 0, notIndexed: 0 })).toBe("");
    expect(missingText({ missing: 3, notIndexed: 1 })).toBe("1 question expects a document that isn't in the knowledge base. 2 questions point at documents that were deleted.");
    expect(configChanges(runs[1]!, runs[0]!)).toEqual(["results per search 4 → 1"]);
    const v2 = run("a", "2026-09-01T00:00:00Z", { config: { ...runs[0]!.config, version: "published", agentVersion: 2 } });
    const v3 = run("b", "2026-09-02T00:00:00Z", { config: { ...runs[0]!.config, version: "published", agentVersion: 3, kbs: [{ ...runs[0]!.config.kbs[0]!, profile: "Qwen 1024" }] } });
    expect(configChanges(v2, v3)).toEqual(["agent v2 → v3", "embedding profile Nomic 768 → Qwen 1024"]);
    const series = scoreSeries([...runs, run("x", "2026-09-28T00:00:00Z", { status: "failed" })], "retrieval");
    expect(series.runs.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(series.markers).toEqual([{ runId: "r2", at: "2026-09-27T10:00:00Z", changes: ["results per search 4 → 1"] }]);
  });

  it("reads expected documents and import formats", () => {
    expect(expectedList(questions[0]!)).toEqual(["Transcript policy", "https://example.edu/registrar/transcripts*"]);
    expect(expectedList({ ...questions[0]!, expectedDocuments: [] })[0]).toBe("Deleted document");
    expect(splitExpected([" https://example.edu/a* ", "guide.pdf", ""], ["d1"])).toEqual({ documentIds: ["d1"], urls: ["https://example.edu/a*"], filenames: ["guide.pdf"] });
    expect(importFormat("set.JSONL")).toBe("jsonl");
    expect(importFormat("questions.csv")).toBe("csv");
    expect(answerEstimate(40)).toBe("40 answers from the agent, counted as chat usage.");
    expect(answerEstimate(1, true)).toBe("1 answer from the agent, counted as chat usage and against the team's monthly budget.");
  });
});

describe("a set's runs", () => {
  it("lists the runs first, with one Score column, and charts the score from three runs, with markers", async () => {
    const third = run("r0", "2026-09-25T10:00:00Z", { summary: { ...runs[1]!.summary, recall: 0.75 } });
    mockApi(evalRoutes("editor", { "GET /v1/teams/registrar/evaluation-sets/set1/runs": () => [...runs, third] }));
    const { container } = renderApp("/teams/registrar/evaluations/set1?tab=runs");
    const table = await screen.findByRole("table", { name: "Runs" }, T);
    const chart = await screen.findByRole("img", { name: /Recall@k over 3 runs, from 75% to 50%/ });
    // The table comes before the chart.
    expect(table.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("list", { name: "What changed between retrieval runs" })).toHaveTextContent("results per search 4 → 1");
    // The score names its metric (in its tooltip and accessible name); runs are "Retrieval", not "Retrieval check".
    expect(within(table).getByRole("columnheader", { name: /Kind/ })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: /^50%\. Recall@1: the share of questions/ })).toBeInTheDocument();
    const links = within(table).getAllByRole("link", { name: /^Retrieval, Sep/ });
    expect(links).toHaveLength(3);
    // G20: the name is one text, not "Retrieval" + ", Sep 28" (browsers join those with a space: "Retrieval , Sep 28").
    expect([...links[0]!.childNodes].filter((n) => !(n instanceof Element && n.getAttribute("aria-hidden"))).map((n) => n.textContent)).toEqual([
      expect.stringMatching(/^Retrieval, Sep \d+, 2026/),
    ]);
    // The chart's scale is fixed at 0–100% (G19): its top line reads 100%, whatever the scores.
    expect(within(chart).getByText("100%")).toBeInTheDocument();
    // A knowledge base's set has only retrieval runs: no kind filter, and no Columns menu on a short table.
    expect(screen.queryByRole("button", { name: /^Full answer/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Columns/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no chart before three completed runs", async () => {
    mockApi(evalRoutes());
    renderApp("/teams/registrar/evaluations/set1?tab=runs");
    expect(await screen.findByRole("table", { name: "Runs" }, T)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Recall@k over/ })).toBeNull();
  });

  it("opens a run with its results, filters them to failures and compares with the previous run", async () => {
    const detail = {
      run: runs[0],
      results: [
        result("res1", "How do I order a transcript?", "pass"),
        result("res2", "When does registration open?", "fail"),
        result("res3", "What about the old fees page?", "missing", { hits: [] }),
      ],
    };
    const compare = {
      a: runs[1],
      b: runs[0],
      better: 0,
      worse: 1,
      same: 2,
      items: [{ questionId: "q2", question: "When does registration open?", change: "worse", a: result("res2", "When does registration open?", "pass"), b: detail.results[1] }],
    };
    const calls = mockApi(
      evalRoutes("editor", {
        "GET /v1/teams/registrar/evaluation-sets/set1/runs/r2": () => detail,
        "GET /v1/teams/registrar/evaluation-sets/set1/runs/compare": () => compare,
      }),
    );
    const { container, router } = renderApp("/teams/registrar/evaluations/set1?tab=runs&record=r2");
    const page = await screen.findByRole("region", { name: "Run" }, T);
    expect(await within(page).findByText(/1 question expects a document that isn't in the knowledge base/)).toBeInTheDocument();
    // The title names the kind without "check"; the subtitle states the result; MRR is explained where it's shown.
    expect(within(page).getByRole("heading", { level: 1, name: /^Retrieval run · / })).toBeInTheDocument();
    expect(within(page).getByText("1 of 2 questions found the right page.")).toBeInTheDocument();
    expect(within(page).getByText(/\(1 of 2\)/)).toBeInTheDocument();
    expect(within(page).getByText(/0\.50\. Mean reciprocal rank/)).toBeInTheDocument();
    const results = within(page).getByRole("table", { name: "Results" });
    expect(within(results).getAllByRole("row")).toHaveLength(4);
    await userEvent.click(within(page).getByRole("button", { name: /^Failures/ }));
    await waitFor(() => expect(within(results).getAllByRole("row")).toHaveLength(2));
    expect(await within(page).findByText("Since that run: 0 better, 1 worse, 2 the same.")).toBeInTheDocument();
    expect(within(page).getByRole("table", { name: "Questions compared with the other run" })).toHaveTextContent("Worse");
    expect(calls.find((c) => c.url.endsWith("/compare"))!.search.toString()).toBe("a=r1&b=r2");
    expect(await axe(container)).toHaveNoViolations();
    // A result opens as a page over the run (a link: it can open in a new tab); its back link returns to the run.
    await userEvent.click(within(page).getByRole("button", { name: "All" }));
    const link = within(results).getByRole("link", { name: "When does registration open?" });
    expect(link).toHaveAttribute("href", expect.stringContaining("result=res2"));
    await userEvent.click(link);
    await waitFor(() => expect(router.state.location.search).toMatchObject({ record: "r2", result: "res2" }));
    const res = await screen.findByRole("region", { name: "Result" });
    expect(within(res).getByRole("link", { name: /Back to Run/ })).toBeInTheDocument();
    expect(within(res).getByRole("heading", { level: 1, name: "When does registration open?" })).toBeInTheDocument();
    expect(within(res).getAllByText("No expected document in the top results.").length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
    // "Open the question" (in the "…" menu) goes to the question's own page.
    await userEvent.click(within(res).getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Open the question/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ record: "q2" }));
  });

  it("shows a full answer as chat does: Markdown, chips for its markers and one source per number, and why a question failed", async () => {
    const answerRun = run("r5", "2026-09-28T10:00:00Z", { kind: "answer", summary: { ...runs[0]!.summary, passRate: 0 } });
    const cite = (n: number, title: string, extra = {}) => ({ rank: n, n, documentId: `d${n}`, title, expected: n === 1, snippet: `**${title}** passage ${n}.`, ...extra });
    const failed = result("res1", "How do I order a transcript?", "fail", {
      answer: "**Order online** [1]. Diplomas are mailed [2], and fees apply [3].",
      hits: [cite(1, "Transcripts"), cite(2, "Diplomas"), cite(3, "Transcripts", { documentId: "d1", expected: true, headingPath: ["Fees"], pageStart: 2 })],
      scores: { cited: true, refused: false, mentions: [{ phrase: "transcript", found: true }, { phrase: "Parchment", found: false }] },
    });
    mockApi(
      evalRoutes("editor", {
        "GET /v1/teams/registrar/evaluation-sets/set1/runs": () => [answerRun, ...runs],
        "GET /v1/teams/registrar/evaluation-sets/set1/runs/r5": () => ({ run: answerRun, results: [failed] }),
      }),
    );
    const { container } = renderApp("/teams/registrar/evaluations/set1?tab=runs&record=r5&result=res1");
    const res = await screen.findByRole("region", { name: "Result" }, T);
    // Rendered Markdown, not raw asterisks.
    expect(await within(res).findByText("Order online", { selector: "strong" }, T)).toBeInTheDocument();
    // The sources start collapsed, as in chat.
    await userEvent.click(within(res).getByRole("button", { name: "Used 3 sources" }));
    const sources = within(res).getByRole("list", { name: "Sources for this answer" });
    expect(within(sources).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual([
      "Source 1: Transcripts (an expected document)",
      "Source 2: Diplomas",
      "Source 3: Transcripts (an expected document)",
    ]);
    expect(within(sources).getByText(/Fees · p. 2/)).toBeInTheDocument();
    expect(within(res).getAllByText("Doesn't mention “Parchment”").length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
    // The run's table: no Rank for full answers, a Why column instead, and each cited document once.
    await userEvent.click(within(res).getByRole("link", { name: /Back to Run/ }));
    const table = await screen.findByRole("table", { name: "Results" });
    expect(within(table).queryByRole("columnheader", { name: /Rank/ })).toBeNull();
    const row = within(table).getByRole("row", { name: /order a transcript/ });
    expect(row).toHaveTextContent("Doesn't mention “Parchment”");
    expect(row).toHaveTextContent("Transcripts, Diplomas");
  });

  it("shows a running run's progress and cancels it", async () => {
    const running = run("r3", "2026-09-28T10:00:00Z", { status: "running", done: 1, total: 3 });
    const calls = mockApi(
      evalRoutes("editor", {
        "GET /v1/teams/registrar/evaluation-sets/set1/runs": () => [running, ...runs],
        "GET /v1/teams/registrar/evaluation-sets/set1/runs/r3": () => ({ run: running, results: [] }),
        "POST /v1/teams/registrar/evaluation-sets/set1/runs/r3/cancel": () => ({ ...running, status: "cancelled" }),
      }),
    );
    const { container } = renderApp("/teams/registrar/evaluations/set1?tab=runs&record=r3");
    const page = await screen.findByRole("region", { name: "Run" }, T);
    expect(await within(page).findByRole("progressbar", { name: "1 of 3 questions checked" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(page).getByRole("button", { name: "Cancel run" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/cancel"))).toBe(true));
  });

  it("starts a full-answer run of an agent's set, with an estimate", async () => {
    const agentSet: Schemas["EvaluationSet"] = { ...set, target: { type: "agent", id: "ag1", name: "Helper" }, questionCount: 40 };
    const calls = mockApi(
      evalRoutes("editor", {
        "GET /v1/teams/registrar/evaluation-sets/set1": () => agentSet,
        "POST /v1/teams/registrar/evaluation-sets/set1/runs": () => run("r9", "2026-09-28T10:00:00Z", { kind: "answer", status: "queued" }),
        "GET /v1/teams/registrar/evaluation-sets/set1/runs/r9": () => ({ run: run("r9", "2026-09-28T10:00:00Z", { kind: "answer", status: "queued" }), results: [] }),
      }),
    );
    renderApp("/teams/registrar/evaluations/set1");
    await userEvent.click(await screen.findByRole("button", { name: "Run" }, T));
    const dialog = await screen.findByRole("dialog", { name: "Run Transcript questions" });
    await userEvent.click(within(dialog).getByRole("radio", { name: /Full answer/ }));
    expect(within(dialog).getByText("40 answers from the agent, counted as chat usage.")).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Version" }), "published");
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ kind: "answer", version: "published" });
    expect(await screen.findByRole("region", { name: "Run" })).toBeInTheDocument();
  });
});

describe("Add to evaluations", () => {
  const answer = (extra: Partial<AssistantItem>): AssistantItem => ({
    role: "assistant", key: "a1", id: "m1", text: "Sorry, I don't know.", thinking: "", steps: [], sources: [], citations: [], status: "done", ...extra,
  });
  const cited = { n: 1, documentId: "d1", sourceId: "s1", title: "Policy", snippet: "…", headingPath: [] };

  it("is offered on thumbs-down answers and answers without sources, with the question only", async () => {
    const add = vi.fn();
    const items: ChatItem[] = [
      { role: "user", key: "u1", text: "How do I order a transcript?" },
      answer({ key: "a1", citations: [cited], feedback: { rating: "down", reason: "incorrect" } }),
      { role: "user", key: "u2", text: "And the fee?" },
      answer({ key: "a2", citations: [cited] }),
      { role: "user", key: "u3", text: "Parking?" },
      answer({ key: "a3", noContext: true }),
    ];
    const { container } = renderBare(<ChatMessages items={items} agent={{ name: "Helper" }} onAddToEvaluations={add} canAdd={needsEvaluation} />);
    const buttons = await screen.findAllByRole("button", { name: "Add to evaluations" });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[1]!);
    expect(add).toHaveBeenCalledWith("Parking?", expect.objectContaining({ key: "a3" }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("adds a Test panel question to a new set of the agent", async () => {
    const calls = mockApi({
      ...shellRoutes("none", "editor"),
      "GET /v1/me": () => meWithEvals("editor"),
      "GET /v1/teams/registrar/evaluation-sets": () => [],
      "GET /v1/teams/registrar/evaluation-documents": () => [{ id: "d1", title: "Bursar office", filename: "bursar.md", url: "", sourceName: "Policies" }],
      "POST /v1/teams/registrar/evaluation-sets": () => ({ ...set, id: "set7", name: "Helper questions" }),
      "POST /v1/teams/registrar/evaluation-sets/set7/questions": () => questions[1],
    });
    const { AddToEvaluationsDialog } = await import("../pages/team/evaluations/add-to-evaluations");
    const answer = { question: "Where is the bursar?", key: "session:a1", cited: [] };
    renderBare(<AddToEvaluationsDialog team="registrar" agentId="ag1" agentName="Helper" answer={answer} onClose={() => {}} />, meWithEvals("editor"));
    const dialog = await screen.findByRole("dialog", { name: "Add to evaluations" });
    expect(within(dialog).getByRole("textbox", { name: "Question" })).toHaveValue("Where is the bursar?");
    expect(await within(dialog).findByRole("textbox", { name: "New set's name" })).toHaveValue("Helper questions");
    // Before the set exists, the picker searches the agent's knowledge bases, by filename too.
    await userEvent.type(within(dialog).getByRole("combobox", { name: "Expected documents" }), "bursar.md");
    expect(await screen.findByRole("option", { name: /Bursar office · bursar.md/ })).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith("/evaluation-documents"))!.search.get("agentId")).toBe("ag1");
    await userEvent.keyboard("{Escape}");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /URLs and filenames/ }), "https://example.edu/bursar*{Enter}");
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add question" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));
    const [created, added] = calls.filter((c) => c.method === "POST");
    expect(created!.body).toEqual({ agentId: "ag1", name: "Helper questions" });
    expect(added!.body).toEqual({ question: "Where is the bursar?", expected: { documentIds: [], urls: ["https://example.edu/bursar*"], filenames: [] }, mustMention: [], note: "" });
  });
});

describe("Admin → Limits › Evaluations", () => {
  it("keeps only the evaluation limits and says where the switch is (Overview → Features)", async () => {
    const limits = { items: [], revision: 1, updatedAt: "2026-09-01T10:00:00Z" };
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/limits": () => limits,
      "GET /v1/admin/settings/evaluations": () => ({ enabled: false, revision: 2, updatedAt: "2026-09-01T10:00:00Z" }),
    });
    const { container } = renderApp("/admin/limits?tab=evaluations");
    expect(await screen.findByText(/Evaluations are off/, {}, T)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview → Features" })).toHaveAttribute("href", "/admin#features");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
