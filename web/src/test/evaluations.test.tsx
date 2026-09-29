/* Evaluation sets (A2, docs/evaluations.md): the Evaluations tab, the set page's Questions and Settings tabs, a question's record page and the import form page. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Reply, mockApi, renderApp } from "./harness";
import { evalRoutes, meWithEvals, questions, result, set } from "./evaluations-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const T = { timeout: 5000 };

describe("a knowledge base's Evaluations tab", () => {
  it("lists the sets for editors and creates one", async () => {
    const calls = mockApi(evalRoutes("editor", { "POST /v1/teams/registrar/evaluation-sets": (body) => ({ ...set, id: "set2", ...(body as object) }) }));
    const { container, router } = renderApp("/teams/registrar/kbs/k1?tab=evaluations");
    const table = await screen.findByRole("table", { name: "Evaluation sets" }, T);
    // The set's name is a link to its page, like the knowledge base list's names.
    const link = await within(table).findByRole("link", { name: "Transcript questions" });
    expect(link).toHaveAttribute("href", "/teams/registrar/evaluations/set1");
    const row = link.closest("tr")!;
    expect(row).toHaveTextContent("2 questions");
    // One Score column, with the metric in the score's tooltip and accessible name.
    expect(within(row).getByRole("button", { name: /^50%\. Recall@4/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Evaluations/, selected: true })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    // Closing the dialog returns focus to its trigger.
    const newSet = screen.getByRole("button", { name: "New set" });
    await userEvent.click(newSet);
    await screen.findByRole("dialog", { name: "New evaluation set" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(newSet).toHaveFocus());
    await userEvent.click(newSet);
    const dialog = await screen.findByRole("dialog", { name: "New evaluation set" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create set" }));
    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Fees");
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create set" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/evaluations/set2"));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ kbId: "k1", name: "Fees", description: "", autoRun: false });
  });

  it("is hidden from members and while evaluations are off", async () => {
    mockApi(evalRoutes("member"));
    renderApp("/teams/registrar/kbs/k1");
    expect(await screen.findByRole("tab", { name: /Try it/ }, T)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Evaluations/ })).toBeNull();
    vi.unstubAllGlobals();
    mockApi(evalRoutes("editor", { "GET /v1/me": () => meWithEvals("editor", false) }));
    renderApp("/teams/registrar/kbs/k1");
    expect(await screen.findAllByRole("tab", { name: /Settings/ }, T)).not.toHaveLength(0);
    expect(screen.queryByRole("tab", { name: /Evaluations/ })).toBeNull();
  });
});

describe("a set's page", () => {
  it("lists the questions and creates one with expected documents", async () => {
    const calls = mockApi(evalRoutes("editor", { "POST /v1/teams/registrar/evaluation-sets/set1/questions": (b) => ({ ...questions[1]!, ...(b as object), id: "q3" }) }));
    const { container } = renderApp("/teams/registrar/evaluations/set1");
    expect(await screen.findByRole("heading", { level: 1, name: "Transcript questions" }, T)).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Questions" });
    const row = within(table).getByText("How do I order a transcript?").closest("tr")!;
    expect(row).toHaveTextContent("Transcript policy, https://example.edu/registrar/transcripts*");
    // A knowledge base's set runs retrieval only: no must-mention phrases.
    expect(within(table).queryByRole("columnheader", { name: /Must mention/ })).toBeNull();
    expect(screen.getByText(/Latest score/)).toBeInTheDocument();
    // Run is the primary; New question is secondary.
    expect(screen.getByRole("button", { name: "New question" })).toHaveAttribute("data-variant", "secondary");
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "New question" }));
    const dialog = await screen.findByRole("dialog", { name: "New question" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create question" }));
    expect(within(dialog).getByText("Enter the question.")).toBeInTheDocument();
    expect(within(dialog).getByText("Pick a document or enter a URL or filename.")).toBeInTheDocument();
    // Matches by filename stay listed (the server matched them; the label carries the filename).
    await userEvent.type(within(dialog).getByRole("combobox", { name: "Expected documents" }), "transcripts.pdf");
    expect(await screen.findByRole("option", { name: /Transcript policy · transcripts.pdf/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Question" }), "Where is the fee schedule?");
    const urls = within(dialog).getByRole("textbox", { name: /URLs and filenames/ });
    await userEvent.type(urls, "https://example.edu/fees*{Enter}fees.pdf{Enter}");
    expect(within(dialog).queryByRole("textbox", { name: /Must mention/ })).toBeNull();
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create question" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      question: "Where is the fee schedule?",
      expected: { documentIds: [], urls: ["https://example.edu/fees*"], filenames: ["fees.pdf"] },
      mustMention: [],
      note: "",
    });
  });

  it("opens a question as a record page with its results across runs", async () => {
    mockApi(
      evalRoutes("editor", {
        "GET /v1/teams/registrar/evaluation-sets/set1/questions/q2": () => ({
          question: questions[1],
          results: [
            { ...result("res2", "When does registration open?", "fail"), runId: "r2", runKind: "retrieval", runTrigger: "nightly", runCreatedAt: "2026-09-27T10:00:00Z" },
            { ...result("res2b", "When does registration open?", "pass"), runId: "r1", runKind: "retrieval", runTrigger: "manual", runCreatedAt: "2026-09-26T10:00:00Z" },
          ],
        }),
      }),
    );
    const { container } = renderApp("/teams/registrar/evaluations/set1?record=q2");
    const page = await screen.findByRole("region", { name: "Question" }, T);
    expect(await within(page).findByRole("heading", { level: 1, name: "When does registration open?" })).toBeInTheDocument();
    expect(within(page).getByText("calendar.pdf")).toBeInTheDocument();
    expect(within(page).getByText(/Nightly/)).toBeInTheDocument();
    expect(within(page).getAllByRole("link", { name: "Registration calendar" })).toHaveLength(2);
    expect(within(page).getByRole("button", { name: /Edit question/ })).toBeInTheDocument();
    // Delete isn't a header button: it's in the "…" menu.
    expect(within(page).queryByRole("button", { name: /^Delete/ })).toBeNull();
    await userEvent.click(within(page).getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: /Delete question/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("imports a CSV: previews the rows it can't use, then adds the rest", async () => {
    const warning = { line: 4, message: "No document in Student handbook matches b.pdf yet. It'll count once one is added." };
    const preview = { rows: 3, usable: 2, added: 0, problems: [{ line: 3, message: "Add at least one expected document" }], warnings: [warning], max: 500, current: 2 };
    const calls = mockApi(
      evalRoutes("editor", {
        "POST /v1/teams/registrar/evaluation-sets/set1/questions/import": (b) => ((b as { dryRun: boolean }).dryRun ? preview : { ...preview, added: 2 }),
      }),
    );
    const { container, router } = renderApp("/teams/registrar/evaluations/set1?form=import");
    const page = await screen.findByRole("region", { name: "Import questions" }, T);
    const csv = "question,expected\nOne?,a.pdf\nTwo?,\nThree?,b.pdf\n";
    await userEvent.upload(within(page).getByLabelText("Choose a file"), new File([csv], "questions.csv", { type: "text/csv" }));
    expect(await within(page).findByRole("table", { name: "Rows that can't be used" })).toHaveTextContent("Add at least one expected document");
    expect(
      within(page).getByText("3 rows read: 2 questions can be added, 1 row can't be used, 1 question expect documents that aren't in the knowledge base yet."),
    ).toHaveAttribute("role", "status");
    expect(within(page).getByRole("table", { name: "Added, but nothing matches yet" })).toHaveTextContent("matches b.pdf yet");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(page).getByRole("button", { name: "Add 2 questions" }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("form"));
    const bodies = calls.filter((c) => c.url.endsWith("/import")).map((c) => c.body as { dryRun: boolean; format: string; content: string });
    expect(bodies.map((b) => b.dryRun)).toEqual([true, false]);
    expect(bodies[1]).toMatchObject({ format: "csv", content: csv });
  });

  it("saves settings and deletes the set from the Danger zone", async () => {
    const calls = mockApi(
      evalRoutes("editor", {
        "PATCH /v1/teams/registrar/evaluation-sets/set1": (b) => ({ ...set, ...(b as object), revision: 4 }),
        "DELETE /v1/teams/registrar/evaluation-sets/set1": () => ({ ok: true }),
      }),
    );
    const { container, router } = renderApp("/teams/registrar/evaluations/set1?tab=settings");
    const auto = await screen.findByRole("switch", { name: /Run automatically/ }, T);
    await userEvent.click(auto);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toEqual({ name: "Transcript questions", description: "What students ask the registrar", autoRun: true });
    expect(patch.headers.get("If-Match")).toBe('"3"');
    await userEvent.click(screen.getByRole("button", { name: "Delete set" }));
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/kbs/k1"));
  });

  it("explains a Run that can't start, and collapses the breadcrumb to Team › … › Set", async () => {
    mockApi(evalRoutes("editor", { "GET /v1/teams/registrar/evaluation-sets/set1": () => ({ ...set, questionCount: 0 }), "GET /v1/teams/registrar/evaluation-sets/set1/questions": () => [] }));
    const { container } = renderApp("/teams/registrar/evaluations/set1");
    // Focusable (aria-disabled, not disabled), with the reason as its description.
    const run = await screen.findByRole("button", { name: "Run" }, T);
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(run).not.toBeDisabled();
    expect(run).toHaveAccessibleDescription("Add questions first.");
    const crumbs = screen.getByRole("navigation", { name: /Breadcrumb/i });
    // "…" is a menu of the hidden crumbs: Knowledge bases › Student handbook › Evaluations.
    const more = within(crumbs).getByRole("button", { name: "Knowledge bases, Student handbook, Evaluations" });
    expect(more).toHaveAttribute("title", "Knowledge bases › Student handbook › Evaluations");
    expect(within(crumbs).queryByRole("link", { name: "Knowledge bases" })).toBeNull();
    expect(within(crumbs).getAllByRole("listitem")).toHaveLength(3);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(more);
    const menu = await screen.findByRole("menu", {}, T);
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Knowledge bases", "Student handbook", "Evaluations"]);
    expect(within(menu).getByRole("menuitem", { name: "Evaluations" })).toHaveAttribute("href", "/teams/registrar/kbs/k1?tab=evaluations");
  });

  it("is not found for members", async () => {
    mockApi(evalRoutes("member", { "GET /v1/teams/registrar/evaluation-sets/set1": () => Reply.error(404, "not_found") }));
    renderApp("/teams/registrar/evaluations/set1");
    expect(await screen.findByRole("heading", { level: 1, name: /Not found|couldn't be found|not found/i }, T)).toBeInTheDocument();
  });
});
