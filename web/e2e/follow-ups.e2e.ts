import { Api } from "./support/api";
import { createTeam, handbook, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * Follow-up suggestions (docs/follow-ups.md), in the UI: an answer with
 * citations gets follow-up questions under it a moment after it ends (the
 * fake chat model suggests one per passage); choosing one asks it in the
 * same conversation, and only the last answer offers them, never the
 * question just asked.
 */
test("follow-up suggestions: chips under the answer ask the question when chosen", async ({ as, admin, a11y }) => {
  test.setTimeout(120_000);
  const owner = await Api.signIn("user");
  const team = await createTeam(admin, owner, { prefix: "follow" });
  // Two documents, so the answer to a suggestion still has another passage to suggest.
  const library = { name: "library-hours.md", body: "# Library hours\n\nThe library is open until midnight during finals week.\n" };
  await publishedAgent(owner, team, { name: "Follow helper", docs: [handbook, library] });
  await owner.dispose();
  const page = await as("user");

  await page.goto(`/a/${team}/follow-helper`);
  const composer = page.getByRole("textbox", { name: "Message Follow helper" });
  const answers = page.getByRole("article", { name: "Follow helper said" });
  const offers = page.getByRole("group", { name: "Suggested follow-up questions" });

  let chosen = "";
  await test.step("an answer with citations offers follow-up questions", async () => {
    await composer.fill("How much does a parking permit cost?");
    await composer.press("Enter");
    await expect(answers.first()).toContainText(handbook.answer);
    await expect(offers).toHaveCount(1);
    const chips = answers.first().getByRole("group", { name: "Suggested follow-up questions" }).getByRole("button");
    await expect(chips.first()).toHaveText(/^What else should I know about .+\?$/);
    chosen = (await chips.first().innerText()).trim();
    await a11y(page, "an answer with follow-up suggestions");
  });

  await test.step("choosing one asks it, and only the last answer offers them", async () => {
    await answers.first().getByRole("button", { name: chosen }).click();
    await expect(answers).toHaveCount(2);
    await expect(page.getByText(chosen, { exact: true })).toHaveCount(1); // the question asked, not offered again
    await expect(answers.nth(1).getByRole("group", { name: "Suggested follow-up questions" })).toBeVisible();
    await expect(answers.first().getByRole("group", { name: "Suggested follow-up questions" })).toHaveCount(0);
    await expect(composer).toHaveValue("");
  });
});

/*
 * On a phone (walkthrough, 2026-10-02): a long suggestion wraps inside its chip instead of running past the screen,
 * the chips line up with the answer's text (from the start, not centred), and they come into view when they arrive.
 */
test("follow-up suggestions on a phone: long chips wrap, start at the answer's edge and come into view", async ({ as, admin, a11y }) => {
  test.setTimeout(120_000);
  const owner = await Api.signIn("user");
  const team = await createTeam(admin, owner, { prefix: "followphone" });
  const heading = "How long an interlibrary loan item takes to arrive at the branch you picked for pickup";
  const loans = { name: "interlibrary-loans.md", body: `# ${heading}\n\nInterlibrary loan items usually arrive within 5 to 7 days.\n` };
  await publishedAgent(owner, team, { name: "Phone helper", docs: [handbook, loans] });
  await owner.dispose();
  const page = await as("user");
  await page.setViewportSize({ width: 390, height: 640 });

  await page.goto(`/a/${team}/phone-helper`);
  const composer = page.getByRole("textbox", { name: "Message Phone helper" });
  await composer.fill("How much does a parking permit cost?");
  await composer.press("Enter");
  const answer = page.getByRole("article", { name: "Phone helper said" }).first();
  await expect(answer).toContainText(handbook.answer);
  const group = answer.getByRole("group", { name: "Suggested follow-up questions" });
  const chip = group.getByRole("button", { name: new RegExp(`about ${heading}\\?$`) });
  await expect(chip).toBeVisible();
  // Brought into view as they arrive.
  await expect(chip).toBeInViewport({ ratio: 1 });

  const box = (await group.boundingBox())!;
  const chipBox = (await chip.boundingBox())!;
  const label = (await group.getByText("You could also ask:").boundingBox())!;
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(box.x + box.width + 0.5); // never wider than the group…
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(390); // …or the screen
  expect(chipBox.height).toBeGreaterThan(40); // its text wrapped onto more lines
  expect(Math.abs(label.x - box.x)).toBeLessThan(1); // rows start at the answer's left edge
  await a11y(page, "follow-up suggestions on a phone");
});
