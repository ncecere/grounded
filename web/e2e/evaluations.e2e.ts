import { Api, type Schemas } from "./support/api";
import { createTeam, handbook } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * Evaluations (A2, docs/evaluations.md), in the UI: an editor creates a set
 * on a knowledge base, imports a CSV, runs a retrieval check and sees a
 * failure, fixes the knowledge base (more results per search), runs again
 * and compares the two runs.
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
    await expect(run.getByText(/50% \(1 of 2\)/)).toBeVisible();
    await a11y(page, "first run");
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
    await expect(run.getByText(/100% \(2 of 2\)/)).toBeVisible();
    await expect(run.getByText("Since that run: 1 better, 0 worse, 1 the same.")).toBeVisible();
    await expect(run.getByRole("table", { name: "Questions compared with the other run" })).toContainText("Better");
    await a11y(page, "second run and comparison");
    await run.getByRole("link", { name: /Back to/ }).click();
    await expect(page.getByRole("img", { name: /Recall@k over 2 runs, from 50% to 100%/ })).toBeVisible();
    await expect(page.getByText(/results per search 1 → 4/)).toBeVisible();
    await a11y(page, "score chart");
  });
  await owner.dispose();
});
