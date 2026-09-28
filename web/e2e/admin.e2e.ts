import { Api, type Schemas } from "./support/api";
import { createTeam, handbook } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * The admin portal as the platform admin. Maintenance mode changes the whole
 * platform, so it is in platform/maintenance.e2e.ts, run after these.
 */

test("overview and logs (sign-ins hidden by default)", async ({ as, a11y }) => {
  const page = await as("admin");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Platform at a glance" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent changes" }).getByRole("listitem").first()).toBeVisible();
  await a11y(page);

  await page.getByRole("region", { name: "Recent changes" }).getByRole("link", { name: "All logs" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Logs" })).toBeVisible();
  const log = page.getByRole("table", { name: "Audit log" });
  const hide = page.getByRole("switch", { name: "Hide sign-ins" });
  await expect(hide).toBeChecked();
  await expect(log.getByRole("row").nth(1)).toBeVisible();
  await expect(log.getByRole("rowheader", { name: /^Signed in/ })).toHaveCount(0);
  await a11y(page);

  await hide.click();
  await expect(hide).not.toBeChecked();
  await expect(log.getByRole("rowheader", { name: /^Signed in/ }).first()).toBeVisible();

  // An entry opens in its record sheet.
  await log.getByRole("rowheader", { name: /^Signed in/ }).first().click();
  await expect(page.getByRole("dialog", { name: /Signed in/ })).toBeVisible();
  await expect(page).toHaveURL(/record=/);
  await a11y(page, "audit record");
});

test("limits: save, and the unsaved-changes guard", async ({ as, admin, a11y }) => {
  // Raising a default is safe while other specs run.
  const limits = await admin.get<Schemas["PlatformLimits"]>("/v1/admin/limits");
  const agents = limits.items.find((it) => it.key === "agents")?.default ?? 25;
  const page = await as("admin");
  await page.goto("/admin/limits");
  await expect(page.getByRole("heading", { level: 1, name: "Limits" })).toBeVisible();
  await a11y(page);

  const field = page.getByRole("textbox", { name: "Default for Agents" });
  const next = String(agents + 1);
  await field.fill(next);
  await expect(page.getByRole("button", { name: "Save limits" })).toBeVisible();
  await a11y(page, "limits with unsaved changes");

  // Leaving asks first; keep editing stays on the page with the change.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview" }).click();
  const guard = page.getByRole("alertdialog", { name: "Leave without saving?" });
  await expect(guard).toBeVisible();
  await a11y(page, "unsaved-changes guard");
  await guard.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL("/admin/limits");
  await expect(field).toHaveValue(next);

  await page.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByText("Limits saved").filter({ visible: true }).first()).toBeVisible(); // a toast (visible copy)
  await expect(page.getByRole("button", { name: "Save limits" })).toBeHidden();

  // Saved: leaving no longer asks.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await a11y(page);
});

test("retention dry run, and a legal hold placed and released", async ({ as, admin, a11y }) => {
  const owner = await Api.signIn("casey");
  const team = await createTeam(admin, owner, { prefix: "hold" });
  await owner.dispose();
  const page = await as("admin");

  await page.goto("/admin/retention");
  await expect(page.getByRole("heading", { level: 1, name: "Retention" })).toBeVisible();
  await a11y(page);
  await page.getByRole("tab", { name: "Dry run" }).click();
  await expect(page).toHaveURL(/tab=report/);
  const report = page.getByRole("table", { name: "What retention would delete now" });
  await expect(report.getByRole("row").nth(1)).toBeVisible();
  await expect(page.getByText("Nothing is deleted by viewing this.")).toBeVisible();
  await a11y(page);

  await page.goto("/admin/legal-holds");
  await expect(page.getByRole("heading", { level: 1, name: "Legal holds" })).toBeVisible();
  await a11y(page);
  await page.getByRole("button", { name: "Place a hold" }).first().click();
  const place = page.getByRole("dialog", { name: "Place a legal hold" });
  await place.getByLabel("Covers").selectOption({ label: "Team" });
  await place.getByRole("textbox").first().fill(team);
  await place.getByLabel("Reason").fill("E2E: litigation hold on this team's records");
  await a11y(page, "place a legal hold");
  await place.getByRole("button", { name: "Place hold" }).click();
  await expect(page.getByText(/^Hold placed on/)).toBeVisible();

  const row = page.getByRole("row", { name: new RegExp(`E2E ${team}`) });
  await expect(row).toBeVisible();
  await row.getByRole("rowheader").click();
  const sheet = page.getByRole("dialog", { name: `Hold on E2E ${team}` });
  await expect(sheet).toBeVisible();
  await a11y(page, "legal hold record");
  await sheet.getByRole("button", { name: "Release hold" }).click();
  const release = page.getByRole("dialog", { name: /^Release the hold on/ });
  await release.getByLabel("Why release it").fill("E2E: the matter is closed");
  await a11y(page, "release a legal hold");
  await release.getByRole("button", { name: "Release hold" }).click();
  await expect(page.getByText("Hold released")).toBeVisible();

  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Released" }).click();
  await expect(page.getByRole("row", { name: new RegExp(`E2E ${team}`) })).toBeVisible();
  await a11y(page);
});

test("break-glass: start a documents session, read, end", async ({ as, admin, a11y }) => {
  const owner = await Api.signIn("casey");
  const team = await createTeam(admin, owner, { prefix: "glass" });
  const src = await owner.post<Schemas["DataSource"]>(`/v1/teams/${team}/sources`, { name: "Incident files", classification: "open" });
  await owner.upload(team, src.id, [handbook]);
  await owner.dispose();
  const page = await as("admin");

  await page.goto("/admin/break-glass");
  await expect(page.getByRole("heading", { level: 1, name: "Break-glass" })).toBeVisible();
  await a11y(page);
  await page.getByRole("button", { name: "Start a session" }).click();
  const start = page.getByRole("dialog", { name: "Start a break-glass session" });
  await start.getByRole("combobox", { name: "Team" }).fill(`E2E ${team}`);
  await page.getByRole("option", { name: new RegExp(`E2E ${team}`) }).click();
  await start.getByLabel("Reason").fill("Investigating support ticket 1234: wrong answers about parking");
  await start.getByRole("checkbox", { name: /Documents/ }).check();
  await a11y(page, "start a break-glass session");
  await start.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByText("Break-glass session started")).toBeVisible();

  // The session's sheet: read the team's documents under it.
  const sheet = page.getByRole("dialog", { name: `Break-glass: E2E ${team}` });
  await expect(sheet).toBeVisible();
  await a11y(page, "break-glass session");
  await sheet.getByRole("link", { name: "Read documents" }).click();
  await expect(page).toHaveURL(`/teams/${team}/sources`);
  await expect(page.getByRole("link", { name: "Incident files" })).toBeVisible();
  await a11y(page);
  await page.getByRole("link", { name: "Incident files" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Incident files" })).toBeVisible();
  await a11y(page);

  // Back on the session: the reads are recorded; end it.
  await page.goto("/admin/break-glass");
  await page.getByRole("button", { name: new RegExp(`^Open the session on E2E ${team}`) }).click();
  await expect(sheet.getByRole("table", { name: "Read log, newest first" })).toBeVisible();
  await a11y(page, "break-glass reads");
  await sheet.getByRole("button", { name: "End now" }).click();
  await expect(page.getByText(/^Session ended/)).toBeVisible();
});
