/*
 * Evaluation results people can trust (the v0.2 review's M6-M9): why a
 * question failed or wasn't scored, Expected beside What came back, passes
 * on a citation alone, the question form's warnings, Enter in the document
 * picker, "Add to evaluations" from an answer, a run that finishes without
 * a reload, and the knowledge base's header action per tab.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { ChatMessages } from "../pages/chat/thread";
import type { AssistantItem, ChatItem } from "../pages/chat/stream";
import { markAdded, resetAdded } from "../pages/team/evaluations/added";
import { answerToAdd, usedNote } from "../pages/team/evaluations/answer-to-add";
import { outcomeText, resultLabel } from "../pages/team/evaluations/labels";
import { mockApi, renderApp, renderBare, shellRoutes } from "./harness";
import { checkReply, evalRoutes, meWithEvals, questions, result, run, runs, set } from "./evaluations-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  resetAdded();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const T = { timeout: 5000 };
const agentSet: Schemas["EvaluationSet"] = { ...set, target: { type: "agent", id: "ag1", name: "Helper" } };
const item = (kind: "document" | "url" | "filename", value: string, extra: Partial<Schemas["EvaluationExpectedItem"]> = {}) => ({ kind, value, state: "indexed" as const, ...extra });

describe("labels", () => {
  it("says why a question wasn't scored, and marks a pass on a citation alone", () => {
    expect(resultLabel(result("a", "Q", "missing", { missingReason: "not_indexed" })).label).toBe("Not in this knowledge base");
    expect(resultLabel(result("a", "Q", "missing", { missingReason: "deleted" })).label).toBe("Document deleted");
    const cited = result("a", "Q", "pass", { scores: { cited: true, refused: false, mentions: [] } });
    expect(resultLabel(cited)).toEqual({ label: "Cited the right source (content not checked)", tone: "info" });
    expect(outcomeText(runs[0]!)).toBe("1 of 2 questions found the right page.");
    const answers = run("x", "2026-09-28T10:00:00Z", { kind: "answer", summary: { ...runs[0]!.summary, citedOnly: 1 } });
    expect(outcomeText(answers)).toBe("1 of 2 answers passed. 1 of them only cited the right source: add must-mention phrases to check what they say.");
  });

  it("takes an answer's cited documents once each, and its rating", () => {
    const cite = (n: number, id: string, title: string) => ({ n, documentId: id, sourceId: "s1", title, snippet: "", headingPath: [] });
    const a = answerToAdd("Q?", { key: "a1", id: "m1", citations: [cite(1, "d1", "Handbook"), cite(2, "d2", "Fees"), cite(3, "d1", "Handbook")], feedback: { reason: "incorrect" } });
    expect(a).toEqual({ question: "Q?", key: "m1", cited: [{ id: "d1", title: "Handbook" }, { id: "d2", title: "Fees" }], reason: "incorrect" });
    expect(usedNote(a.cited)).toBe("The answer used Handbook and Fees. Is that the right source?");
    expect(answerToAdd("Q?", { key: "a9", citations: [] }).key).toBe("session:a9");
  });
});

describe("a result's page", () => {
  const failed = result("res2", "When does registration open?", "fail", {
    k: 4,
    searchDepth: 50,
    expectedItems: [
      item("filename", "calendar.pdf", { title: "Academic calendar", rank: 11, documentId: "d7", sourceId: "s1" }),
      item("url", "https://example.edu/dates*", { state: "not_indexed" }),
    ],
    hits: [
      { rank: 1, documentId: "d9", title: "Registration calendar", url: "https://example.edu/calendar", expected: false, snippet: "**Registration** opens in March." },
      { rank: 3, documentId: "d8", title: "Fees", expected: false, snippet: "Fees are due…" },
    ],
  });
  const routes = (extra = {}) =>
    evalRoutes("editor", {
      "GET /v1/teams/registrar/evaluation-sets/set1/runs/r2": () => ({ run: runs[0], results: [failed] }),
      "GET /v1/teams/registrar/evaluation-sets/set1/questions/q2": () => ({ question: questions[1], results: [] }),
      ...extra,
    });

  it("shows Expected beside What came back, with the rank beyond k, and says why once", async () => {
    mockApi(routes());
    const { container } = renderApp("/teams/registrar/evaluations/set1?tab=runs&record=r2&result=res2");
    const res = await screen.findByRole("region", { name: "Result" }, T);
    expect(await within(res).findByText("No expected document in the top 4: the first came back at #11.")).toBeInTheDocument();
    expect(within(res).getAllByText(/No expected document in the top/)).toHaveLength(1);
    expect(within(res).getByRole("heading", { level: 3, name: "Expected" })).toBeInTheDocument();
    expect(within(res).getByText("Found at #11, beyond the top 4")).toBeInTheDocument();
    expect(within(res).getByText("Not in this knowledge base")).toBeInTheDocument();
    // What came back: numbered 1-n, each document once, its best passage named when it isn't its row, with the passage's start.
    const came = within(res).getByRole("heading", { level: 3, name: "What came back" }).parentElement!;
    const rows = within(came).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Registration opens in March.");
    expect(rows[1]).toHaveTextContent("best passage #3");
    // No one-row Details card.
    expect(within(res).queryByText("Why")).toBeNull();
    expect(within(res).getByRole("link", { name: /Try this search/ })).toHaveAttribute("href", expect.stringMatching(/\/teams\/registrar\/kbs\/k1\?tab=try&q=When/));
    expect(within(res).getByRole("link", { name: /Open expected document/ })).toHaveAttribute("href", "/teams/registrar/sources/s1?tab=documents&record=d7");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(res).getByRole("button", { name: /Edit question/ }));
    expect(await screen.findByRole("dialog", { name: "Edit question" })).toBeInTheDocument();
  });

  it("says a question wasn't scored because nothing in the knowledge base matches, and still lists what came back", async () => {
    const missing = result("res3", "What about the old fees page?", "missing", { missingReason: "not_indexed", expectedItems: [item("url", "https://example.edu/fees*", { state: "not_indexed" })] });
    mockApi(routes({ "GET /v1/teams/registrar/evaluation-sets/set1/runs/r2": () => ({ run: runs[0], results: [failed, missing] }) }));
    renderApp("/teams/registrar/evaluations/set1?tab=runs&record=r2");
    const table = await screen.findByRole("table", { name: "Results" }, T);
    const row = await within(table).findByRole("row", { name: /old fees page/ });
    expect(row).toHaveTextContent("Not in this knowledge base");
    expect(row).not.toHaveTextContent("deleted");
    expect(row).toHaveTextContent("Registration calendar");
    expect(within(table).getByRole("row", { name: /registration open/ })).toHaveTextContent("#11 (beyond the top 4)");
  });
});

describe("full-answer passes on a citation alone", () => {
  it("are labelled, counted in the summary and filterable", async () => {
    const answerRun = run("r5", "2026-09-28T10:00:00Z", { kind: "answer", summary: { ...runs[0]!.summary, passRate: 1, passed: 2, failed: 0, citedOnly: 1 } });
    const only = result("res1", "How do I order a transcript?", "pass", { answer: "Online [1].", scores: { cited: true, refused: false, mentions: [] } });
    const checked = result("res4", "What does it cost?", "pass", { answer: "$10 [1].", scores: { cited: true, refused: false, mentions: [{ phrase: "$10", found: true }] } });
    mockApi(
      evalRoutes("editor", {
        "GET /v1/teams/registrar/evaluation-sets/set1": () => agentSet,
        "GET /v1/teams/registrar/evaluation-sets/set1/runs": () => [answerRun, ...runs],
        "GET /v1/teams/registrar/evaluation-sets/set1/runs/r5": () => ({ run: answerRun, results: [only, checked] }),
      }),
    );
    const { container } = renderApp("/teams/registrar/evaluations/set1?tab=runs&record=r5");
    const page = await screen.findByRole("region", { name: "Run" }, T);
    expect(await within(page).findByText(/1 of them only cited the right source/)).toBeInTheDocument();
    expect(within(page).getByText(/1 passed on the citation alone/)).toBeInTheDocument();
    const table = within(page).getByRole("table", { name: "Results" });
    expect(within(table).getByRole("row", { name: /order a transcript/ })).toHaveTextContent("Cited the right source (content not checked)");
    expect(within(table).getByRole("row", { name: /cost/ })).toHaveTextContent("Pass");
    await userEvent.click(within(page).getByRole("button", { name: /^Content not checked/ }));
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(2));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("the question form", () => {
  it("warns about expected documents and phrases the knowledge bases don't hold, without blocking", async () => {
    const calls = mockApi(
      evalRoutes("editor", {
        "GET /v1/teams/registrar/evaluation-sets/set1": () => agentSet,
        "POST /v1/teams/registrar/evaluation-question-check": checkReply(["grad-housing.pdf", "Parchment"]),
        "POST /v1/teams/registrar/evaluation-sets/set1/questions": (b) => ({ ...questions[1]!, ...(b as object), id: "q3" }),
      }),
    );
    renderApp("/teams/registrar/evaluations/set1");
    await userEvent.click(await screen.findByRole("button", { name: "New question" }, T));
    const dialog = await screen.findByRole("dialog", { name: "New question" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Question" }), "Where is grad housing?");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /URLs and filenames/ }), "grad-housing.pdf{Enter}");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Must mention/ }), "Parchment{Enter}");
    const docs = await within(dialog).findByRole("list", { name: "Expected documents not in the knowledge base" }, T);
    expect(docs).toHaveTextContent("No document in Helper's knowledge bases matches “grad-housing.pdf” yet. It'll count once one is added.");
    expect(within(dialog).getByRole("list", { name: "Phrases not in the knowledge base" })).toHaveTextContent(
      "“Parchment” isn't in Helper's knowledge bases, so the answer can't contain it from the sources.",
    );
    expect(calls.find((c) => c.url.endsWith("/evaluation-question-check"))!.body).toMatchObject({ setId: "set1" });
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create question" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/questions"))).toBe(true));
  });

  it("doesn't submit on Enter in the document picker", async () => {
    const calls = mockApi(evalRoutes());
    renderApp("/teams/registrar/evaluations/set1");
    await userEvent.click(await screen.findByRole("button", { name: "New question" }, T));
    const dialog = await screen.findByRole("dialog", { name: "New question" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Question" }), "Where?");
    const picker = within(dialog).getByRole("combobox", { name: "Expected documents" });
    await userEvent.type(picker, "transcripts.pdf");
    await screen.findByRole("option", { name: /Transcript policy/ });
    await userEvent.keyboard("{Escape}");
    // With the list closed, Enter's default (the browser submitting the dialog's form, whose button sits outside it) is prevented.
    // user-event doesn't submit a form through a button outside it, so the default is checked directly; the e2e spec presses it.
    expect(fireEvent.keyDown(picker, { key: "Enter" })).toBe(false);
    expect(screen.getByRole("dialog", { name: "New question" })).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/questions"))).toBe(false);
  });
});

describe("Add to evaluations from an answer", () => {
  it("prefills the cited documents, asks what a good answer says after Incorrect, and marks the answer Added", async () => {
    const calls = mockApi({
      ...shellRoutes("none", "editor"),
      "GET /v1/me": () => meWithEvals("editor"),
      "GET /v1/teams/registrar/evaluation-sets": () => [agentSet],
      "GET /v1/teams/registrar/evaluation-sets/set1/documents": () => [],
      "POST /v1/teams/registrar/evaluation-question-check": checkReply(),
      "POST /v1/teams/registrar/evaluation-sets/set1/questions": () => questions[0],
    });
    const { AddToEvaluationsDialog } = await import("../pages/team/evaluations/add-to-evaluations");
    const answer = { question: "How do I order a transcript?", key: "m1", cited: [{ id: "d1", title: "QA Handbook" }], reason: "incorrect" };
    renderBare(<AddToEvaluationsDialog team="registrar" agentId="ag1" agentName="Helper" answer={answer} onClose={() => {}} />, meWithEvals("editor"));
    const dialog = await screen.findByRole("dialog", { name: "Add to evaluations" });
    expect(within(dialog).getByText(/The answer used QA Handbook\. Is that the right source\?/)).toBeInTheDocument();
    expect(within(dialog).getByText("QA Handbook")).toBeInTheDocument();
    // After Incorrect, "What should a good answer say?" comes before the expected documents.
    const say = within(dialog).getByRole("textbox", { name: /What should a good answer say\?/ });
    const picker = within(dialog).getByRole("combobox", { name: "Expected documents" });
    expect(say.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.type(say, "online{Enter}");
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add question" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/questions"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/questions"))!.body).toMatchObject({ expected: { documentIds: ["d1"] }, mustMention: ["online"] });
    expect(JSON.parse(localStorage.getItem("grounded.evaluations.added") ?? "[]")).toEqual(["m1"]);
  });

  it("shows a labelled button, and Added once added, after a reload too", async () => {
    const answer: AssistantItem = { role: "assistant", key: "a1", id: "m1", text: "No idea.", thinking: "", steps: [], sources: [], citations: [], status: "done" };
    const items: ChatItem[] = [{ role: "user", key: "u1", text: "Parking?" }, answer];
    markAdded("m1");
    resetAdded(); // as after a reload: read back from storage
    const { container } = renderBare(<ChatMessages items={items} agent={{ name: "Helper" }} onAddToEvaluations={() => {}} added={() => false} />);
    expect(await screen.findByRole("button", { name: "Add to evaluations" })).toHaveTextContent("Add to evaluations");
    expect(await axe(container)).toHaveNoViolations();
    const { useAddedAnswers, answerKey } = await import("../pages/team/evaluations/added");
    function Thread() {
      const isAdded = useAddedAnswers();
      return <ChatMessages items={items} agent={{ name: "Helper" }} onAddToEvaluations={() => {}} added={(i) => isAdded(answerKey(i))} />;
    }
    renderBare(<Thread />);
    expect(await screen.findByText("Added to evaluations")).toBeInTheDocument();
  });
});

describe("a running run", () => {
  it("shows Completed without a reload", async () => {
    const running = run("r3", "2026-09-28T10:00:00Z", { status: "running", done: 0, total: 1 });
    let polls = 0;
    mockApi(
      evalRoutes("editor", {
        "GET /v1/teams/registrar/evaluation-sets/set1/runs/r3": () => {
          polls++;
          return { run: polls < 2 ? running : { ...running, status: "completed", done: 1 }, results: [] };
        },
      }),
    );
    renderApp("/teams/registrar/evaluations/set1?tab=runs&record=r3");
    const page = await screen.findByRole("region", { name: "Run" }, T);
    expect(await within(page).findByText("Running")).toBeInTheDocument();
    expect(await within(page).findByText("Completed", {}, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe("the knowledge base's header action follows the tab", () => {
  it("is New set on Evaluations, not repeated in the empty list", async () => {
    mockApi(evalRoutes("editor", { "GET /v1/teams/registrar/evaluation-sets": () => [] }));
    const { container } = renderApp("/teams/registrar/kbs/k1?tab=evaluations");
    expect(await screen.findByText("No evaluation sets yet.", {}, T)).toBeInTheDocument();
    const newSet = screen.getAllByRole("button", { name: "New set" });
    expect(newSet).toHaveLength(1);
    expect(newSet[0]).toHaveAttribute("data-variant", "primary");
    expect(screen.queryByRole("button", { name: /Attach source/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is none on Try it, which searches a question passed in (Try this search)", async () => {
    const calls = mockApi(evalRoutes("editor", { "POST /v1/teams/registrar/kbs/k1/retrieve": () => ({ hits: [], latencyMs: 3 }) }));
    renderApp("/teams/registrar/kbs/k1?tab=try&q=How%20do%20I%20order%20a%20transcript%3F");
    expect(await screen.findByRole("textbox", { name: "Question or search terms" }, T)).toHaveValue("How do I order a transcript?");
    expect(screen.queryByRole("button", { name: /Attach source|New set/ })).toBeNull();
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/retrieve"))?.body).toMatchObject({ query: "How do I order a transcript?" }));
  });

  it("is Attach source on Sources", async () => {
    mockApi(evalRoutes());
    renderApp("/teams/registrar/kbs/k1?tab=sources");
    expect(await screen.findByRole("button", { name: /Attach source/ }, T)).toHaveAttribute("data-variant", "primary");
  });
});
