import { Api, type Schemas } from "./support/api";
import { createTeam, handbook } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * v0.4.2 (BU-04): the documents table's selection follows its filters. A
 * selected row that a filter hides is no longer selected, so the bulk bar,
 * the footer and the Delete dialog agree, and Delete removes exactly the
 * rows it names.
 */
test("a filter clears a hidden selection, and bulk Delete deletes exactly what it names", async ({ as, admin, a11y }) => {
  test.setTimeout(90_000);
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "docsel" });
  const base = `/v1/teams/${team}`;
  const src = await owner.post<Schemas["DataSource"]>(`${base}/sources`, { name: "Selection files", classification: "open" });
  await owner.upload(team, src.id, [handbook, { name: "office-hours.txt", body: "The transportation office is open 9 to 5 on weekdays.\n" }]);
  const docs = async () => (await owner.get<Schemas["DocumentPage"]>(`${base}/sources/${src.id}/documents`)).items;
  await expect.poll(async () => (await docs()).map((d) => d.status), { timeout: 30_000 }).toEqual(["ready", "ready"]);
  const page = await as("alex");

  await page.goto(`/teams/${team}/sources/${src.id}?tab=documents`);
  await expect(page.getByRole("table", { name: "Documents" })).toBeVisible();
  await a11y(page);
  await page.getByRole("checkbox", { name: "Select parking handbook" }).check();
  await expect(page.getByText("1 document selected")).toBeVisible();

  // Kind = Text hides the Markdown file: its selection goes with it.
  await page.getByRole("combobox", { name: "Kind" }).click();
  await page.getByRole("option", { name: "Text" }).click();
  await expect(page.getByRole("checkbox", { name: "Select parking handbook" })).toBeHidden();
  await expect(page.getByText(/document selected/)).toBeHidden();
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeHidden();
  await a11y(page, "documents filtered by kind");

  await page.getByRole("checkbox", { name: "Select office hours" }).check();
  await expect(page.getByText("1 document selected")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete office hours?" });
  await expect(dialog).toBeVisible();
  await a11y(page, "delete one document");
  await dialog.getByRole("button", { name: "Delete document" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await docs()).map((d) => d.filename)).toEqual([handbook.name]);
  await owner.dispose();
});
