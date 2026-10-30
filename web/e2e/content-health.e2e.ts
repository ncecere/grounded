import { scaled } from "../test-scale";
import { Api } from "./support/api";
import { createTeam, handbook } from "./support/arrange";
import { expect, test } from "./support/fixtures";
import type { Schemas } from "./support/api";

/*
 * The content health report (docs/content-health.md), in the UI: off until a platform admin turns it on; an editor makes a report
 * of the team's own sources, the background job collects it, and the page says in words what each signal found and could not
 * measure; a member is told it is for editors. The platform switch is the only platform-wide state it touches, and nothing else
 * relies on it being off.
 */
test("content health: an editor makes a report; unmeasurable signals say so; members can't open it", async ({ as, admin, a11y }) => {
  test.setTimeout(scaled(120_000));
  const owner = await Api.signIn("user");
  const team = await createTeam(admin, owner, { prefix: "health", members: { alex: "editor", blair: "member" } });
  const src = await owner.post<Schemas["DataSource"]>(`/v1/teams/${team}/sources`, { name: "Handbook", classification: "open" });
  await owner.upload(team, src.id, [handbook]);
  await expect
    .poll(async () => (await owner.get<Schemas["DocumentPage"]>(`/v1/teams/${team}/sources/${src.id}/documents`)).items.map((d) => d.status), { timeout: scaled(30_000) })
    .toEqual(["ready"]);

  const editor = await as("alex");
  await test.step("the switch is a platform admin's: while off, the page says so and offers nothing", async () => {
    const st = await admin.get<Schemas["ContentHealthSettings"]>("/v1/admin/settings/content-health");
    if (st.enabled) await admin.putRevised("/v1/admin/settings/content-health", { enabled: false });
    await editor.goto(`/teams/${team}/content-health`);
    await expect(editor.getByRole("heading", { level: 1, name: "Content health" })).toBeVisible();
    await expect(editor.getByText("Content health reports are switched off.")).toBeVisible();
    await expect(editor.getByRole("button", { name: "Make report" })).toHaveCount(0);
    await a11y(editor, "content health, off");
    await admin.putRevised("/v1/admin/settings/content-health", { enabled: true });
  });

  await test.step("the editor makes a report and reads it", async () => {
    await editor.reload();
    await expect(editor.getByText(/No website is fetched, no AI model is used, and nothing is changed or deleted/)).toBeVisible();
    await expect(editor.getByText("No report yet.")).toBeVisible();
    await a11y(editor, "content health, no report yet");
    await editor.getByRole("button", { name: "Make report" }).click();
    const signals = editor.getByRole("list", { name: "Signals" });
    await expect(signals).toBeVisible({ timeout: scaled(60_000) });
    const cards = signals.getByRole("listitem");
    await expect(cards).toHaveCount(5);
    // A new document is not stale, and with no answers kept nothing can be said about citations: unavailable, never a zero.
    const cited = cards.filter({ hasText: "No retained citation evidence" });
    await expect(cited.getByText("Unavailable")).toBeVisible();
    await expect(cited.getByRole("button", { name: /Show findings/ })).toBeDisabled();
    const stale = cards.filter({ hasText: "Not processed in a long time" });
    await expect(stale.getByText("Measured")).toBeVisible();
    await expect(stale.getByText("No document is older than the threshold.")).toBeVisible();
    await expect(editor.getByRole("table", { name: "Sources in this report" }).getByRole("link", { name: "Handbook" })).toBeVisible();
    await a11y(editor, "content health, report");
  });

  await test.step("a second report right away is refused with the reason, and the page stays usable by keyboard", async () => {
    await editor.getByRole("button", { name: "Make report" }).click();
    await expect(editor.getByText(/A report was made a moment ago/)).toBeVisible();
    await editor.getByRole("button", { name: "What this does not mean" }).first().focus();
    await editor.keyboard.press("Enter");
    await expect(editor.getByText(/Grounded doesn't know/).first()).toBeVisible();
    await a11y(editor, "content health, refused");
  });

  await test.step("on a phone the page fits", async () => {
    await editor.setViewportSize({ width: 390, height: 844 });
    await expect(editor.getByRole("heading", { level: 1, name: "Content health" })).toBeVisible();
    const overflow = await editor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await a11y(editor, "content health, phone");
  });

  await test.step("a member is told it is for editors, and gets no link to it", async () => {
    const member = await as("blair");
    await member.goto(`/teams/${team}/content-health`);
    await expect(member.getByText("Only editors, admins and owners can see content health reports.")).toBeVisible();
    await expect(member.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Content health", exact: true })).toHaveCount(0);
    await expect(member.getByRole("list", { name: "Signals" })).toHaveCount(0);
  });
});
