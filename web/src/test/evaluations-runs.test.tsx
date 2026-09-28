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
    expect(missingText(0)).toBe("");
    expect(missingText(3)).toBe("3 questions point at documents that were deleted.");
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
    expect(answerEstimate(40)).toBe("About 40 answers from the agent, counted as chat usage.");
  });
});

describe("a set's runs", () => {
  it("charts the score with markers and lists the runs", async () => {
    mockApi(evalRoutes());
    const { container } = renderApp("/teams/registrar/evaluations/set1?tab=runs");
    expect(await screen.findByRole("img", { name: /Recall@k over 2 runs, from 100% to 50%/ }, T)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "What changed between retrieval runs" })).toHaveTextContent("results per search 4 → 1");
    const table = screen.getByRole("table", { name: "Runs" });
    expect(await within(table).findAllByText("Recall@1 50% · MRR 0.50")).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
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
    expect(await within(page).findByText(/1 question points at a document that was deleted/)).toBeInTheDocument();
    expect(within(page).getByText(/50% \(1 of 2\) · MRR 0.50/)).toBeInTheDocument();
    const results = within(page).getByRole("table", { name: "Results" });
    expect(within(results).getAllByRole("row")).toHaveLength(4);
    await userEvent.click(within(page).getByRole("button", { name: /^Failures/ }));
    await waitFor(() => expect(within(results).getAllByRole("row")).toHaveLength(2));
    expect(await within(page).findByText("Since that run: 0 better, 1 worse, 2 the same.")).toBeInTheDocument();
    expect(within(page).getByRole("table", { name: "Questions compared with the other run" })).toHaveTextContent("Worse");
    expect(calls.find((c) => c.url.endsWith("/compare"))!.search.toString()).toBe("a=r1&b=r2");
    expect(await axe(container)).toHaveNoViolations();
    // A result opens its question's record page on the Questions tab.
    await userEvent.click(within(results).getByRole("button", { name: "When does registration open?" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ record: "q2" }));
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

  it("starts a full-answer check of an agent's set, with an estimate", async () => {
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
    await userEvent.click(within(dialog).getByRole("radio", { name: /Full-answer check/ }));
    expect(within(dialog).getByText("About 40 answers from the agent, counted as chat usage.")).toBeInTheDocument();
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
    expect(add).toHaveBeenCalledWith("Parking?");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("adds a Test panel question to a new set of the agent", async () => {
    const calls = mockApi({
      ...shellRoutes("none", "editor"),
      "GET /v1/me": () => meWithEvals("editor"),
      "GET /v1/teams/registrar/evaluation-sets": () => [],
      "POST /v1/teams/registrar/evaluation-sets": () => ({ ...set, id: "set7" }),
      "POST /v1/teams/registrar/evaluation-sets/set7/questions": () => questions[1],
    });
    const { AddToEvaluationsDialog } = await import("../pages/team/evaluations/add-to-evaluations");
    renderBare(<AddToEvaluationsDialog team="registrar" agentId="ag1" agentName="Helper" question="Where is the bursar?" onClose={() => {}} />, meWithEvals("editor"));
    const dialog = await screen.findByRole("dialog", { name: "Add to evaluations" });
    expect(within(dialog).getByRole("textbox", { name: "Question" })).toHaveValue("Where is the bursar?");
    expect(await within(dialog).findByRole("textbox", { name: "New set's name" })).toHaveValue("Helper questions");
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
  it("turns evaluations off for the platform", async () => {
    const limits = { items: [], revision: 1, updatedAt: "2026-09-01T10:00:00Z" };
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/limits": () => limits,
      "GET /v1/admin/settings/evaluations": () => ({ enabled: true, revision: 2, updatedAt: "2026-09-01T10:00:00Z" }),
      "PUT /v1/admin/settings/evaluations": (b) => ({ ...(b as object), revision: 3, updatedAt: "2026-09-28T10:00:00Z" }),
    });
    const { container } = renderApp("/admin/limits?tab=evaluations");
    const toggle = await screen.findByRole("switch", { name: /Allow evaluations/ }, T);
    expect(toggle).toBeChecked();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(toggle);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({ enabled: false });
    expect(put.headers.get("If-Match")).toBe('"2"');
    expect(await screen.findByText(/Existing sets and runs are kept/)).toBeInTheDocument();
  });
});
