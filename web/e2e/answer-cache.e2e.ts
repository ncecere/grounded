import { Api } from "./support/api";
import { createTeam, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * Saved answers (the answer cache, docs/answer-cache.md), in the UI: an
 * editor turns them on for a team agent (off by default unless public)
 * under Agent → Settings; the same question asked twice gets the same
 * answer, the second time saved (the chat looks the same); the editor sees
 * it counted and clears the saved answers after confirming.
 */
test("saved answers: an editor turns them on, a repeated question is reused, the editor clears them", async ({ as, admin, a11y }) => {
  test.setTimeout(120_000);
  const owner = await Api.signIn("user");
  const team = await createTeam(admin, owner, { prefix: "cache", members: { alex: "editor" } });
  const { agent } = await publishedAgent(owner, team, { name: "Permit helper" });

  const editor = await as("alex");
  const settings = `/teams/${team}/agents/${agent.id}?tab=settings`;
  await test.step("the editor turns saved answers on", async () => {
    await editor.goto(settings);
    const section = editor.locator("#saved-answers");
    await expect(section.getByText("Each question is answered afresh.", { exact: false })).toBeVisible();
    const reuse = section.getByRole("switch", { name: "Reuse answers", exact: true });
    await expect(reuse).not.toBeChecked();
    await reuse.click();
    await expect(reuse).toBeChecked();
    await expect(section.getByText("0 saved answers, reused 0 times.", { exact: false })).toBeVisible();
    await a11y(editor, "agent settings with saved answers");
  });

  await test.step("the same question twice gets the same answer", async () => {
    const texts: string[] = [];
    for (let i = 0; i < 2; i++) {
      await editor.goto(`/a/${team}/permit-helper`);
      const composer = editor.getByRole("textbox", { name: "Message Permit helper" });
      await composer.fill("Where do students buy a parking permit?");
      await composer.press("Enter");
      const answer = editor.getByRole("article", { name: "Permit helper said" });
      await expect(answer.getByRole("button", { name: "Good answer" })).toBeVisible();
      texts.push((await answer.innerText()).trim());
      if (i === 1) await a11y(editor, "a saved answer in the chat");
    }
    expect(texts[1]).toBe(texts[0]);
  });

  await test.step("the editor sees it counted and clears it", async () => {
    await editor.goto(settings);
    const section = editor.locator("#saved-answers");
    await expect(section.getByText("1 saved answer, reused once.", { exact: false })).toBeVisible();
    await section.getByRole("button", { name: "Clear saved answers" }).click();
    const dialog = editor.getByRole("alertdialog", { name: "Clear this agent's saved answers?" });
    await a11y(editor, "clear saved answers dialog");
    await dialog.getByRole("button", { name: "Clear saved answers" }).click();
    await expect(section.getByText("0 saved answers, reused 0 times.", { exact: false })).toBeVisible();
    await expect(section.getByRole("button", { name: "Clear saved answers" })).toBeDisabled();
  });
});
