import { Api } from "./support/api";
import { createTeam, handbook, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * The agent editor's widget preview (Share tab): the /embed page runs outside
 * the app's session gate, so it has to load the session (and its CSRF token)
 * itself before it posts to the draft's test endpoint. Both the inline frame
 * and "Open in new tab" answer.
 */
test("the Share tab's widget preview answers, inline and in its own tab", async ({ as, admin, a11y }) => {
  test.setTimeout(90_000);
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "preview" });
  const { agent } = await publishedAgent(owner, team, { name: "Preview helper", audience: "public" });
  await owner.dispose();
  const page = await as("alex");

  await test.step("inline preview in the Share tab", async () => {
    await page.goto(`/teams/${team}/agents/${agent.id}?tab=share`);
    await expect(page.getByRole("tab", { name: "Share", selected: true })).toBeVisible();
    await a11y(page);
    const frame = page.frameLocator('iframe[title="Widget preview of Preview helper"]');
    const composer = frame.getByRole("textbox", { name: "Message Preview helper" });
    await expect(composer).toBeEnabled();
    const posted = page.waitForResponse((r) => r.url().endsWith(`/agents/${agent.id}/test`) && r.request().method() === "POST");
    await composer.fill("How much is a student parking permit?");
    await composer.press("Enter");
    expect((await posted).status()).toBe(200);
    await expect(frame.getByRole("article", { name: "Preview helper said" })).toContainText(handbook.answer);
  });

  await test.step("the preview opened in its own tab", async () => {
    await page.goto(`/embed/${agent.id}?preview=1&team=${team}`);
    const composer = page.getByRole("textbox", { name: "Message Preview helper" });
    await expect(composer).toBeEnabled();
    await a11y(page);
    await composer.fill("How much is a student parking permit?");
    await composer.press("Enter");
    await expect(page.getByRole("article", { name: "Preview helper said" })).toContainText(handbook.answer);
    await expect(page.getByText("Invalid request token or origin")).toHaveCount(0);
    await a11y(page, "preview answer");
  });
});
