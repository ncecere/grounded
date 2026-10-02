import { Api } from "./support/api";
import { createTeam, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * The gap report (docs/gaps.md), in the UI: a member rates an answer down
 * and shares the question with the team (the tick is off by default); the
 * team's editor sees it waiting on the Gaps page (a topic needs 3 different
 * people, and the hourly job, before it shows) and in the agent's Analytics;
 * the member can't open the Gaps page.
 */
test("gap report: share a question on a thumbs-down; editors see it pending, members can't open Gaps", async ({ as, admin, a11y }) => {
  test.setTimeout(120_000);
  const owner = await Api.signIn("user");
  const team = await createTeam(admin, owner, { prefix: "gaps", members: { alex: "editor", blair: "member" } });
  const { agent } = await publishedAgent(owner, team, { name: "Parking helper" });

  const member = await as("blair");
  const answer = (p: typeof member) => p.getByRole("article", { name: "Parking helper said" });
  await test.step("a member rates an answer down and shares the question", async () => {
    await member.goto(`/a/${team}/parking-helper`);
    const composer = member.getByRole("textbox", { name: "Message Parking helper" });
    await composer.fill("Can visitors park in Lot 4 on weekends?");
    await composer.press("Enter");
    const answer = member.getByRole("article", { name: "Parking helper said" });
    await expect(answer.getByRole("button", { name: "Good answer" })).toBeVisible();
    await answer.getByRole("button", { name: "Bad answer" }).click();
    const share = member.getByRole("menuitemcheckbox", { name: "Share this question with the team" });
    await expect(share).toHaveAttribute("aria-checked", "false");
    await share.click();
    await expect(share).toHaveAttribute("aria-checked", "true");
    await a11y(member, "thumbs-down menu");
    const sent = member.waitForRequest((r) => r.url().includes("/feedback") && r.method() === "POST");
    await member.getByRole("menuitem", { name: "Missing sources" }).click();
    expect((await sent).postDataJSON()).toEqual({ rating: "down", reason: "missing_sources", share: true });
    await expect(member.getByText("Thanks for the feedback")).toBeVisible();
    // Focus stays on the button after choosing a reason (aud-4).
    const bad = answer.getByRole("button", { name: "Bad answer: Missing sources" });
    await expect(bad).toBeFocused();
  });

  await test.step("unticking Share on the rated answer takes the question back at once", async () => {
    await answer(member).getByRole("button", { name: "Bad answer: Missing sources" }).click();
    const share = member.getByRole("menuitemcheckbox", { name: "Share this question with the team" });
    await expect(share).toHaveAttribute("aria-checked", "true");
    const sent = member.waitForRequest((r) => r.url().includes("/feedback") && r.method() === "POST");
    await share.click();
    expect((await sent).postDataJSON()).toEqual({ rating: "down", reason: "missing_sources", share: false });
    await expect(member.getByText("Your question is no longer shared")).toBeVisible();
    await member.keyboard.press("Escape");
    await member.reload();
    await answer(member).getByRole("button", { name: "Bad answer: Missing sources" }).click();
    await expect(member.getByRole("menuitemcheckbox", { name: "Share this question with the team" })).toHaveAttribute("aria-checked", "false");
    await member.keyboard.press("Escape");
  });

  await test.step("the member can't open the Gaps page", async () => {
    await member.goto(`/teams/${team}/gaps`);
    // Exact names: the team is called "E2E gaps-…", and role names match substrings.
    const nav = member.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Data sources", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Gaps", exact: true })).toHaveCount(0);
    await expect(member.getByRole("heading", { level: 1, name: "Gaps", exact: true })).toHaveCount(0);
  });

  const editor = await as("alex");
  await test.step("the editor sees the question waiting for a topic, without its text", async () => {
    await editor.goto(`/teams/${team}`);
    await expect(editor.getByRole("heading", { level: 1 })).toBeVisible();
    await a11y(editor, "team overview");
    await editor.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Gaps" }).click();
    await expect(editor.getByRole("heading", { level: 1, name: "Gaps" })).toBeVisible();
    await expect(editor.getByText("1 failed question from the last 30 days isn't shown.")).toBeVisible();
    await expect(editor.getByText(/isn't grouped yet: questions are grouped every hour\./)).toBeVisible();
    await expect(editor.getByText("No open topics.")).toBeVisible();
    await expect(editor.getByText("Can visitors park in Lot 4 on weekends?")).toHaveCount(0);
    await a11y(editor);
    await editor.goto(`/teams/${team}/agents/${agent.id}?tab=analytics&view=gaps`);
    await expect(editor.getByText(/1 failed question from the last 30 days isn't shown\./)).toBeVisible();
    await expect(editor.getByLabel("Analytics period")).toHaveCount(0);
    await a11y(editor, "agent gaps");
  });
});
