/* Questions that need attention (A14, docs/v0.4.1.md §2): the set's count, the Questions tab's filter and column, the question's note and the run dialog's count. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { cantPassText, problemTexts } from "../pages/team/evaluations/attention";
import { mockApi, renderApp } from "./harness";
import { evalRoutes, questions, result, run } from "./evaluations-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const T = { timeout: 5000 };

type Problem = Schemas["EvaluationQuestionProblem"];
const problem = (questionId: string, extra: Partial<Problem> = {}): Problem => ({
  questionId,
  expected: [],
  missingReason: null,
  mustMention: [],
  outOfReach: null,
  ...extra,
});
const outOfReach = { runs: 3, depth: 50, runId: "r2", resultId: "res1" };
const notIndexed = problem("q2", { expected: [{ kind: "filename", value: "calendar.pdf", state: "not_indexed" }], missingReason: "not_indexed" });

describe("the words", () => {
  it("says each problem as the question form does, then out of reach", () => {
    expect(problemTexts(notIndexed, "Student handbook", false)).toEqual(["No document in Student handbook matches “calendar.pdf” yet. It'll count once one is added."]);
    expect(problemTexts(problem("q1", { mustMention: ["Parchment"], outOfReach }), "Helper's knowledge bases", true)).toEqual([
      "“Parchment” isn't in Helper's knowledge bases, so the answer can't contain it from the sources.",
      "Expected page not found in the top 50 (last 3 runs).",
    ]);
  });

  it("counts the questions that can't pass a run of each kind", () => {
    const phrase = problem("q1", { mustMention: ["Parchment"] });
    const reach = problem("q3", { outOfReach });
    expect(cantPassText([phrase, reach], "retrieval")).toBeUndefined();
    expect(cantPassText([notIndexed, phrase, reach], "retrieval")).toBe("1 question can't pass: none of its expected documents is indexed. You can still start the run.");
    expect(cantPassText([notIndexed, { ...notIndexed, questionId: "q4" }], "retrieval")).toBe(
      "2 questions can't pass: their expected documents aren't indexed. You can still start the run.",
    );
    expect(cantPassText([notIndexed, phrase], "answer")).toBe(
      "2 questions can't pass: their expected documents aren't indexed, or a must-mention phrase is in no source. You can still start the run.",
    );
  });
});

describe("a set that needs attention", () => {
  const routes = (list: Problem[]) => evalRoutes("editor", { "GET /v1/teams/registrar/evaluation-sets/set1/problems": () => list });

  it("counts the questions in the header and filters the Questions tab to them", async () => {
    mockApi(routes([notIndexed]));
    const { container, router } = renderApp("/teams/registrar/evaluations/set1");
    const count = await screen.findByRole("link", { name: "1 question needs attention" }, T);
    const table = await screen.findByRole("table", { name: "Questions" });
    expect(within(table).getByRole("columnheader", { name: /Needs attention/ })).toBeInTheDocument();
    const row = within(table).getByText("When does registration open?").closest("tr")!;
    expect(row).toHaveTextContent("No document in Student handbook matches “calendar.pdf” yet.");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(await axe(container)).toHaveNoViolations();

    // The count links to the filter; the filter is a toggle in the URL.
    await userEvent.click(count);
    await waitFor(() => expect(router.state.location.search).toMatchObject({ attention: "needs" }));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Questions" })).getAllByRole("row")).toHaveLength(2));
    expect(screen.queryByText("How do I order a transcript?")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /All questions/ }));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Questions" })).getAllByRole("row")).toHaveLength(3));
  });

  it("shows nothing when every question can pass", async () => {
    mockApi(routes([]));
    renderApp("/teams/registrar/evaluations/set1");
    const table = await screen.findByRole("table", { name: "Questions" }, T);
    expect(within(table).queryByRole("columnheader", { name: /Needs attention/ })).toBeNull();
    expect(screen.queryByText(/need attention|needs attention/)).toBeNull();
    expect(screen.queryByRole("group", { name: "Filters" })).toBeNull();
  });

  it("links an out-of-reach question to its latest result", async () => {
    mockApi(
      evalRoutes("editor", {
        "GET /v1/teams/registrar/evaluation-sets/set1/problems": () => [problem("q1", { outOfReach })],
        "GET /v1/teams/registrar/evaluation-sets/set1/questions/q1": () => ({
          question: questions[0],
          results: [{ ...result("res1", "How do I order a transcript?", "fail"), runId: "r2", runKind: "retrieval", runTrigger: "nightly", runCreatedAt: "2026-09-27T10:00:00Z" }],
        }),
      }),
    );
    const { container } = renderApp("/teams/registrar/evaluations/set1?record=q1");
    const page = await screen.findByRole("region", { name: "Question" }, T);
    expect(await within(page).findByText("Expected page not found in the top 50 (last 3 runs).")).toBeInTheDocument();
    const link = within(page).getByRole("link", { name: "See the latest result" });
    expect(link.getAttribute("href")).toMatch(/tab=runs/);
    expect(link.getAttribute("href")).toMatch(/record=r2/);
    expect(link.getAttribute("href")).toMatch(/result=res1/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says in the run dialog how many questions can't pass, without blocking the run", async () => {
    const calls = mockApi(
      evalRoutes("editor", {
        "GET /v1/teams/registrar/evaluation-sets/set1/problems": () => [notIndexed, problem("q1", { outOfReach })],
        "POST /v1/teams/registrar/evaluation-sets/set1/runs": () => run("r9", "2026-09-28T10:00:00Z", { status: "queued" }),
        "GET /v1/teams/registrar/evaluation-sets/set1/runs/r9": () => ({ run: run("r9", "2026-09-28T10:00:00Z", { status: "queued" }), results: [] }),
      }),
    );
    renderApp("/teams/registrar/evaluations/set1");
    await userEvent.click(await screen.findByRole("button", { name: "Run" }, T));
    const dialog = await screen.findByRole("dialog", { name: "Run Transcript questions" });
    expect(await within(dialog).findByText("1 question can't pass: none of its expected documents is indexed. You can still start the run.")).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
    const start = within(dialog).getByRole("button", { name: "Start run" });
    expect(start).toBeEnabled();
    await userEvent.click(start);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/runs"))).toBe(true));
  });
});
