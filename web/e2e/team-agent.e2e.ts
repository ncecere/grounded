import { Api } from "./support/api";
import { createTeam, handbook } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * The main path, in the UI: an upload source with a file, a knowledge base
 * over it, an agent on the fake chat model, publishing, a streamed chat with
 * citations, and feedback on the answer.
 */
test("upload source, knowledge base, agent, publish, streamed chat with citations, feedback", async ({ as, admin, a11y }) => {
  test.setTimeout(120_000);
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "flow" });
  await owner.dispose();
  const page = await as("alex");

  await test.step("create an upload source and upload a file", async () => {
    await page.goto(`/teams/${team}/sources`);
    await expect(page.getByRole("heading", { level: 1, name: "Data sources" })).toBeVisible();
    await a11y(page);
    await page.getByRole("button", { name: "New data source" }).first().click();
    const choose = page.getByRole("dialog", { name: "New data source" });
    await choose.getByRole("radio", { name: /Upload files/ }).check();
    await a11y(page, "new data source: type");
    await choose.getByRole("button", { name: "Continue" }).click();

    const sheet = page.getByRole("dialog", { name: "New upload source" });
    await sheet.getByLabel("Name").fill("Parking files");
    await expect(sheet.getByLabel("Embedding profile")).toHaveValue(/.+/);
    await a11y(page, "new upload source");
    await sheet.getByRole("button", { name: "Create data source" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Parking files" })).toBeVisible();
    await a11y(page);
    await page.getByRole("button", { name: "Upload files" }).first().click();
    const upload = page.getByRole("dialog", { name: "Upload files" });
    await upload.getByLabel("Choose files to upload").setInputFiles({ name: handbook.name, mimeType: "text/markdown", buffer: Buffer.from(handbook.body) });
    await expect(upload.getByRole("list", { name: "Upload results" }).getByText(handbook.name)).toBeVisible();
    await a11y(page, "upload results");
    await upload.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("region", { name: "Document counts" }).getByText("1 ready")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("create a knowledge base and attach the source", async () => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Knowledge bases" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Knowledge bases" })).toBeVisible();
    await a11y(page);
    await page.getByRole("button", { name: "New knowledge base" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New knowledge base" });
    await dialog.getByLabel("Name").fill("Parking KB");
    await a11y(page, "new knowledge base");
    await dialog.getByRole("button", { name: "Create knowledge base" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Parking KB" })).toBeVisible();
    await a11y(page);
    await page.getByRole("tab", { name: /^Sources/ }).click();
    await expect(page).toHaveURL(/tab=sources/);
    await a11y(page);
    await page.getByRole("button", { name: "Attach source" }).click();
    const attach = page.getByRole("dialog", { name: "Attach a source to Parking KB" });
    await attach.getByRole("radio", { name: /Parking files/ }).check();
    await a11y(page, "attach a source");
    await attach.getByRole("button", { name: "Attach source" }).click();
    await expect(attach).toBeHidden();
    await expect(page.getByRole("link", { name: "Parking files" })).toBeVisible();
  });

  await test.step("create an agent on the fake chat model and publish it", async () => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Agents", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Agents", exact: true })).toBeVisible();
    await a11y(page);
    await page.getByRole("button", { name: "New agent" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New agent" });
    await dialog.getByLabel("Name").fill("Parking helper");
    await dialog.getByRole("checkbox", { name: "Parking KB" }).check();
    await expect(dialog.getByText("E2E chat")).toBeVisible();
    await a11y(page, "new agent");
    await dialog.getByRole("button", { name: "Create agent" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Parking helper" })).toBeVisible();
    await a11y(page);
    await page.getByRole("button", { name: "Publish" }).click();
    const publish = page.getByRole("dialog", { name: "Publish this agent?" });
    await a11y(page, "publish dialog");
    await publish.getByRole("button", { name: "Publish" }).click();
    await expect(publish).toBeHidden();
    await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();
  });

  await test.step("chat: a streamed answer with citations, then feedback", async () => {
    await page.getByRole("link", { name: "Chat" }).click();
    await expect(page).toHaveURL(`/a/${team}/parking-helper`);
    const composer = page.getByRole("textbox", { name: "Message Parking helper" });
    await expect(composer).toBeEnabled();
    await a11y(page);

    await composer.fill("How much is a student parking permit?");
    const stream = page.waitForResponse((r) => r.url().endsWith(`/v1/agents/${team}/parking-helper/chat`));
    await composer.press("Enter");
    expect((await stream).headers()["content-type"]).toContain("text/event-stream");

    const answer = page.getByRole("article", { name: "Parking helper said" });
    await expect(answer).toContainText(handbook.answer);
    await expect(answer.getByRole("button", { name: "Good answer" })).toBeVisible();
    const source = answer.getByRole("list", { name: "Sources for this answer" }).getByRole("listitem", { name: /^Source 1: / });
    await expect(source).toContainText(handbook.answer);
    await a11y(page, "answer with sources");

    // The citation mark in the text jumps to its source card.
    await answer.getByRole("button", { name: /^Source 1: / }).click();
    await expect(source).toBeFocused();

    await answer.getByRole("button", { name: "Good answer" }).click();
    await expect(page.getByText("Thanks for the feedback")).toBeVisible();
    await expect(answer.getByRole("button", { name: "Good answer" })).toHaveAttribute("aria-pressed", "true");
    await a11y(page, "after feedback");
  });
});
