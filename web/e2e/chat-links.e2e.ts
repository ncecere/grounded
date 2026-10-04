import { Api } from "./support/api";
import { createTeam, handbook, publishedAgent } from "./support/arrange";
import { composerClips } from "./support/layout";
import { expect, test } from "./support/fixtures";

/*
 * v0.4.2 M1: a link to a conversation that isn't there (US-01) asks once and says so, and the chat's composer is never
 * cut off at the bottom (BU-19, on the chat page as M2 fixed it in Try it), at desktop, phone and 200% zoom sizes.
 */

test("a link to a deleted conversation says it isn't available, without a request loop, and a new chat starts from it", async ({ as, admin, a11y }) => {
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "links" });
  await publishedAgent(owner, team, { name: "Links helper" });
  await owner.dispose();
  const page = await as("alex");
  let requests = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/v1/conversations")) requests++;
  });
  await page.goto(`/a/${team}/links-helper?c=00000000-0000-4000-8000-000000000000`);
  await expect(page.getByRole("heading", { name: "This conversation isn't available." })).toBeVisible();
  await page.waitForTimeout(1500);
  // One for the conversation, the chat's list and the sidebar's recent ones: not 70 a second.
  expect(requests).toBeLessThanOrEqual(4);
  await a11y(page, "a conversation that isn't there");
  await page.getByRole("button", { name: "Start a new chat" }).click();
  await expect(page).toHaveURL(new RegExp(`/a/${team}/links-helper$`));
  await expect(page.getByRole("textbox", { name: "Message Links helper" })).toBeVisible();
});

test("the chat's composer isn't cut off at the bottom, at any size, with the source viewer open too (BU-19)", async ({ as, admin }) => {
  test.setTimeout(90_000);
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "composer" });
  await publishedAgent(owner, team, { name: "Composer helper" });
  await owner.dispose();
  const page = await as("alex");
  await page.goto(`/a/${team}/composer-helper`);
  const composer = page.getByRole("textbox", { name: "Message Composer helper" });
  await composer.fill("How much is a student parking permit?");
  await composer.press("Enter");
  const answer = page.getByRole("article", { name: "Composer helper said" });
  await expect(answer).toContainText(handbook.answer);
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [720, 450]] as const) {
    await page.setViewportSize({ width, height });
    await composer.focus();
    await expect.poll(() => composerClips(page), { message: `${width}x${height}` }).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await answer.getByRole("button", { name: /^Used \d sources?$/ }).click();
  await answer.getByRole("button", { name: /^Show source 1: / }).click();
  await expect(page.getByTestId("source-viewer")).toBeVisible();
  await expect.poll(() => composerClips(page), { message: "with the viewer open" }).toEqual([]);
});
