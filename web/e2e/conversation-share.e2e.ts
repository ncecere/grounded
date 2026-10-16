import { Api } from "./support/api";
import { createTeam, handbook, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * Sharing a conversation (v0.6.0, C12), across four people: the owner chats and makes a link; a member of the agent's team reads it, source
 * and all; an anonymous visitor is asked to sign in; someone outside the team is told it isn't available; revoking closes it for everyone.
 */
test("share a conversation: make a link, a team member reads it, others cannot, revoke", async ({ as, page, a11y }) => {
  test.setTimeout(150_000);
  const ownerApi = await Api.signIn("alex");
  const team = await createTeam(await Api.signIn("admin"), ownerApi, { prefix: "share", members: { blair: "member" } });
  const { agent } = await publishedAgent(ownerApi, team, { name: "Parking helper" });
  await ownerApi.dispose();
  const owner = await as("alex");
  let path = "";

  await test.step("the owner chats and makes a link", async () => {
    await owner.goto(`/a/${team}/${agent.slug}`);
    const composer = owner.getByRole("textbox", { name: "Message Parking helper" });
    await expect(composer).toBeEnabled();
    await a11y(owner, "chat before the question");
    await composer.fill("How much is a student parking permit?");
    await composer.press("Enter");
    await expect(owner.getByRole("article", { name: "Parking helper said" })).toContainText(handbook.answer);

    await owner.getByRole("button", { name: "Conversation actions" }).click();
    await owner.getByRole("menuitem", { name: "Share…" }).click();
    const dialog = owner.getByRole("dialog", { name: "Share this conversation" });
    await expect(dialog).toContainText("Anyone who opens the link can read this conversation");
    // A team agent: a link for everyone is not offered.
    await expect(dialog.getByRole("radio", { name: /Anyone with the link/ })).toHaveCount(0);
    await expect(dialog.getByRole("radio", { name: /People who can use Parking helper/ })).toBeChecked();
    await a11y(owner, "share this conversation");
    await dialog.getByRole("button", { name: "Create link" }).click();
    const link = dialog.getByText(/\/shared\/[A-Za-z0-9_-]{43}$/);
    await expect(link).toBeVisible();
    path = new URL((await link.textContent()) ?? "").pathname;
    await expect(dialog.getByRole("list", { name: "Links to this conversation" }).getByRole("listitem")).toHaveCount(1);
    await a11y(owner, "share: the link, once");
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  const member = await as("blair");
  await test.step("a member of the agent's team reads it, source and all, read only", async () => {
    await member.goto(path);
    await expect(member.getByRole("heading", { level: 1 })).toBeVisible();
    // The question is the page's title and the first message.
    await expect(member.getByRole("article", { name: "You said" })).toContainText("How much is a student parking permit?");
    const answer = member.getByRole("article", { name: "Parking helper said" });
    await expect(answer).toContainText(handbook.answer);
    await expect(member.getByText(/read-only copy of the conversation as it was when it was shared/)).toBeVisible();
    // Read only: no composer, no feedback.
    await expect(member.getByRole("textbox")).toHaveCount(0);
    await expect(answer.getByRole("button", { name: "Good answer" })).toHaveCount(0);
    await expect(member.getByRole("link", { name: /Ask Parking helper/ })).toHaveAttribute("href", `/a/${team}/${agent.slug}`);
    await a11y(member, "a shared conversation");
    await answer.getByRole("button", { name: "Used 1 source" }).click();
    await answer.getByRole("button", { name: /^Show source 1: / }).click();
    await expect(member.getByText("Cited passage").first()).toBeVisible();
    // The conversation and the source scroll in their own panes: the page itself never grows past the window.
    expect(await member.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
    await a11y(member, "a shared conversation: a source opens");
  });

  await test.step("no session: asked to sign in; someone outside the team: not available", async () => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to open this conversation" })).toBeVisible();
    await a11y(page, "a shared conversation, signed out");
    await page.goto(`/shared/${"A".repeat(42)}Q`);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to open this conversation" })).toBeVisible();
    const outsider = await as("casey");
    await outsider.goto(path);
    await expect(outsider.getByRole("heading", { level: 1, name: "This conversation isn't available" })).toBeVisible();
    await expect(outsider.getByText("How much is a student parking permit?")).toHaveCount(0);
    await a11y(outsider, "a shared conversation, not available");
  });

  await test.step("the owner revokes it and it closes for everyone", async () => {
    await owner.getByRole("button", { name: "Conversation actions" }).click();
    await owner.getByRole("menuitem", { name: "Share…" }).click();
    const dialog = owner.getByRole("dialog", { name: "Share this conversation" });
    await dialog.getByRole("button", { name: /Revoke the link made/ }).click();
    const confirm = owner.getByRole("alertdialog");
    await a11y(owner, "revoke a link");
    await confirm.getByRole("button", { name: "Revoke link" }).click();
    await expect(dialog.getByText("You haven't made a link to this conversation.")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
    await member.reload();
    await expect(member.getByRole("heading", { level: 1, name: "This conversation isn't available" })).toBeVisible();
  });
});
