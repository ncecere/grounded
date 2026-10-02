import { Api, type Schemas } from "./support/api";
import { createTeam, handbook } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * Evaluations (A2, docs/evaluations.md), in the UI: an editor creates a set
 * on a knowledge base, imports a CSV, is warned about an expected document
 * the knowledge base doesn't have, runs a retrieval check and sees a failure
 * with the expected document's real rank, fixes the knowledge base (more
 * results per search), runs again, compares the two runs and, after a third
 * run, sees the score over time.
 */
const housing = { name: "housing-guide.md", body: "Residence halls open for move-in on August 18. Bring your campus ID card to check in.\n" };

test("evaluation set: create, import a CSV, run, see a failure, fix, run again, compare", async ({ as, admin, a11y }) => {
  test.setTimeout(180_000);
  const owner = await Api.signIn("user");
  const team = await createTeam(admin, owner, { prefix: "evals", members: { alex: "editor" } });
  // Arranged through the API: a source with two documents and a knowledge base returning one passage per search.
  const base = `/v1/teams/${team}`;
  const src = await owner.post<Schemas["DataSource"]>(`${base}/sources`, { name: "Student files", classification: "open" });
  await owner.upload(team, src.id, [handbook, housing]);
  await expect
    .poll(async () => (await owner.get<Schemas["DocumentPage"]>(`${base}/sources/${src.id}/documents`)).items.map((d) => d.status), { timeout: 30_000 })
    .toEqual(["ready", "ready"]);
  const kb = await owner.post<Schemas["KnowledgeBase"]>(`${base}/kbs`, { name: "Student help", topK: 1 });
  await owner.put(`${base}/kbs/${kb.id}/sources/${src.id}`);
  const page = await as("alex");

  await test.step("create a set on the knowledge base", async () => {
    await page.goto(`/teams/${team}/kbs/${kb.id}?tab=evaluations`);
    await expect(page.getByRole("heading", { level: 2, name: "Evaluation sets" })).toBeVisible();
    await expect(page.getByText("No evaluation sets yet.")).toBeVisible();
    await a11y(page);
    await page.getByRole("button", { name: "New set" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New evaluation set" });
    await dialog.getByLabel("Name").fill("Student questions");
    await a11y(page, "new evaluation set");
    await dialog.getByRole("button", { name: "Create set" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Student questions" })).toBeVisible();
    await expect(page.getByText("No questions yet.")).toBeVisible();
    await a11y(page);
  });

  await test.step("import a CSV, with a row it can't use", async () => {
    await page.getByRole("button", { name: "Import questions" }).click();
    const form = page.getByRole("region", { name: "Import questions" });
    const csv = [
      "question,expected,must_mention",
      `Where do students buy parking permits?,${handbook.name},permit`,
      `When do residence halls open for move-in?,${handbook.name},`,
      "A question without a document,,",
    ].join("\n");
    await form.getByLabel("Choose a file").setInputFiles({ name: "questions.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(form.getByRole("table", { name: "Rows that can't be used" })).toContainText("expected document");
    await a11y(page, "import preview");
    await form.getByRole("button", { name: "Add 2 questions" }).click();
    await expect(form).toBeHidden();
    await expect(page.getByRole("table", { name: "Questions" }).getByText("When do residence halls open for move-in?")).toBeVisible();
  });

  await test.step("a new question warns about a document the knowledge base doesn't have, and Enter in the picker doesn't submit", async () => {
    await page.getByRole("button", { name: "New question" }).click();
    const dialog = page.getByRole("dialog", { name: "New question" });
    await dialog.getByRole("textbox", { name: "Question" }).fill("Where is graduate housing?");
    const picker = dialog.getByRole("combobox", { name: "Expected documents" });
    await picker.fill("parking");
    await expect(page.getByRole("option", { name: /parking-handbook\.md/ })).toBeVisible();
    await picker.press("Escape");
    await picker.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: /URLs and filenames/ }).fill("grad-housing-faq.pdf");
    await dialog.getByRole("textbox", { name: /URLs and filenames/ }).press("Enter");
    await expect(dialog.getByText("No document in Student help matches “grad-housing-faq.pdf” yet. It'll count once one is added.")).toBeVisible();
    // A knowledge base's set runs retrieval only: no must-mention phrases.
    await expect(dialog.getByRole("textbox", { name: /Must mention/ })).toHaveCount(0);
    await a11y(page, "question warnings");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("alertdialog", { name: "Leave without saving?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("run a retrieval check and see the failure", async () => {
    await page.getByRole("button", { name: "Run", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Run Student questions" });
    await a11y(page, "run dialog");
    await dialog.getByRole("button", { name: "Start run" }).click();
    const run = page.getByRole("region", { name: "Run" });
    await expect(run.getByText("Completed", { exact: true })).toBeVisible({ timeout: 60_000 });
    const results = run.getByRole("table", { name: "Results" });
    await expect(results.getByRole("row", { name: /residence halls/ })).toContainText("Fail");
    await expect(results.getByRole("row", { name: /parking permits/ })).toContainText("Pass");
    await expect(run.getByText("1 of 2 questions found the right page.")).toBeVisible();
    await a11y(page, "first run");
    // The failure's page: what was expected, found beyond the top 1, beside what came back.
    await results.getByRole("link", { name: /residence halls/ }).click();
    const result = page.getByRole("region", { name: "Result" });
    await expect(result.getByText("No expected document in the top 1: the first came back at #2.")).toBeVisible();
    await expect(result.getByText("Found at #2, beyond the top 1")).toBeVisible();
    await expect(result.getByRole("heading", { name: "What came back", exact: true })).toBeVisible();
    await expect(result.getByText("housing-guide.md").or(result.getByText(/Residence halls open/)).first()).toBeVisible();
    await expect(result.getByRole("link", { name: /Try this search/ })).toBeVisible();
    await a11y(page, "result page");
    await result.getByRole("link", { name: /Back to/ }).click();
    await run.getByRole("link", { name: /Back to/ }).click();
    await expect(page.getByRole("table", { name: "Runs" })).toBeVisible();
    await a11y(page);
  });

  await test.step("fix the knowledge base, run again and compare", async () => {
    const current = await owner.get<Schemas["KnowledgeBase"]>(`${base}/kbs/${kb.id}`);
    await owner.patch(`${base}/kbs/${kb.id}`, { topK: 4 }, { headers: { "If-Match": `"${current.revision}"` } });
    await page.getByRole("button", { name: "Run", exact: true }).first().click();
    await page.getByRole("dialog", { name: "Run Student questions" }).getByRole("button", { name: "Start run" }).click();
    const run = page.getByRole("region", { name: "Run" });
    await expect(run.getByText("Completed", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(run.getByText("2 of 2 questions found the right page.")).toBeVisible();
    await expect(run.getByText("Since that run: 1 better, 0 worse, 1 the same.")).toBeVisible();
    await expect(run.getByRole("table", { name: "Questions compared with the other run" })).toContainText("Better");
    await a11y(page, "second run and comparison");
    await run.getByRole("link", { name: /Back to/ }).click();
    // Two runs are too few for a trend: the table only.
    await expect(page.getByRole("table", { name: "Runs" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Recall@\S+ over/ })).toHaveCount(0);
  });

  await test.step("a third run charts the score over time, under the runs", async () => {
    await page.getByRole("button", { name: "Run", exact: true }).first().click();
    await page.getByRole("dialog", { name: "Run Student questions" }).getByRole("button", { name: "Start run" }).click();
    const run = page.getByRole("region", { name: "Run" });
    await expect(run.getByText("Completed", { exact: true })).toBeVisible({ timeout: 60_000 });
    await run.getByRole("link", { name: /Back to/ }).click();
    await expect(page.getByRole("img", { name: /Recall@k over 3 runs, from 50% to 100%/ })).toBeVisible();
    await expect(page.getByText(/results per search 1 → 4/)).toBeVisible();
    await a11y(page, "score chart");
  });
  await owner.dispose();
});

/*
 * Expectations the knowledge base can't meet (A14, docs/v0.4.1.md §2): the
 * set's page counts the questions that need attention, filters the
 * Questions tab to them, and the run dialog says how many can't pass
 * without blocking the run.
 */
test("evaluation set: questions that need attention", async ({ as, admin, a11y }) => {
  test.setTimeout(120_000);
  const owner = await Api.signIn("user");
  const team = await createTeam(admin, owner, { prefix: "evals-attention", members: { alex: "editor" } });
  const base = `/v1/teams/${team}`;
  const src = await owner.post<Schemas["DataSource"]>(`${base}/sources`, { name: "Student files", classification: "open" });
  await owner.upload(team, src.id, [handbook]);
  await expect
    .poll(async () => (await owner.get<Schemas["DocumentPage"]>(`${base}/sources/${src.id}/documents`)).items.map((d) => d.status), { timeout: 30_000 })
    .toEqual(["ready"]);
  const kb = await owner.post<Schemas["KnowledgeBase"]>(`${base}/kbs`, { name: "Student help", topK: 4 });
  await owner.put(`${base}/kbs/${kb.id}/sources/${src.id}`);
  const set = await owner.post<Schemas["EvaluationSet"]>(`${base}/evaluation-sets`, { kbId: kb.id, name: "Student questions" });
  const questions = `${base}/evaluation-sets/${set.id}/questions`;
  await owner.post(questions, { question: "Where do students buy parking permits?", expected: { documentIds: [], urls: [], filenames: [handbook.name] } });
  await owner.post(questions, { question: "Where is graduate housing?", expected: { documentIds: [], urls: [], filenames: ["grad-housing-faq.pdf"] } });
  const page = await as("alex");

  await test.step("the set's page counts them and filters the questions", async () => {
    await page.goto(`/teams/${team}/evaluations/${set.id}`);
    const count = page.getByRole("link", { name: "1 question needs attention" });
    await expect(count).toBeVisible();
    const table = page.getByRole("table", { name: "Questions" });
    await expect(table.getByRole("row", { name: /graduate housing/ })).toContainText("No document in Student help matches “grad-housing-faq.pdf” yet.");
    await a11y(page, "needs attention");
    await count.click();
    await expect(page).toHaveURL(/attention=needs/);
    await expect(table.getByRole("row", { name: /parking permits/ })).toHaveCount(0);
    await expect(table.getByRole("row", { name: /graduate housing/ })).toBeVisible();
    await page.getByRole("button", { name: "All questions" }).click();
    await expect(table.getByRole("row", { name: /parking permits/ })).toBeVisible();
  });

  await test.step("the run dialog says how many can't pass, and still runs", async () => {
    await page.getByRole("button", { name: "Run", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Run Student questions" });
    await expect(dialog.getByText("1 question can't pass: none of its expected pages is indexed. You can still start the run.")).toBeVisible();
    await a11y(page, "run dialog with a warning");
    await dialog.getByRole("button", { name: "Start run" }).click();
    const run = page.getByRole("region", { name: "Run" });
    await expect(run.getByText("Completed", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(run.getByRole("table", { name: "Results" }).getByRole("row", { name: /graduate housing/ })).toContainText("Not in this knowledge base");
  });
  await owner.dispose();
});
