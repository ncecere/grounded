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
  // The optional features and their states (v0.2.1 I2); the evaluations switch is platform-wide, so it isn't pressed here.
  const features = page.getByRole("region", { name: "Features" });
  await expect(features.getByRole("switch", { name: "Allow evaluations" })).toBeVisible();
  await expect(features.getByRole("link", { name: /Cost settings/ })).toBeVisible();
  await expect(features.getByRole("link", { name: /Evaluation limits/ })).toHaveAttribute("href", "/admin/limits?tab=evaluations");
  // Turning evaluations off asks first; cancelled here, since the switch is platform-wide.
  await features.getByRole("switch", { name: "Allow evaluations" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Turn evaluations off for every team?" });
  await expect(confirm).toBeVisible();
  await a11y(page, "turn evaluations off?");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(features.getByRole("switch", { name: "Allow evaluations" })).toBeChecked();
  // The sidebar's groups (v0.2.1 I1).
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const group of ["People", "Content", "Models", "Usage & spend", "Safety", "Records", "Operations"]) await expect(nav.getByRole("button", { name: group })).toBeVisible();
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

  // An entry opens as its record page.
  await log.getByRole("rowheader", { name: /^Signed in/ }).first().click();
  await expect(page.getByRole("region", { name: /Signed in/ })).toBeVisible();
  await expect(page).toHaveURL(/record=/);
  await a11y(page, "audit record");
});

test("a field focused after a failed submit isn't hidden under the sticky top bar", async ({ as }) => {
  const page = await as("admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/mcp-servers?form=new");
  const form = page.getByRole("region", { name: "Add MCP server" });
  await form.getByRole("button", { name: "Add MCP server" }).click();
  const name = form.getByRole("textbox", { name: "Name" });
  await expect(name).toBeFocused();
  const box = (await name.boundingBox())!;
  const bar = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-height")) * 16);
  expect(box.y).toBeGreaterThanOrEqual(bar);
});

test("embedding profiles: the Migrations tab, and the old Profile migrations address", async ({ as, a11y }) => {
  const page = await as("admin");
  // Profile migrations is a tab of Embedding profiles (v0.2.1 I1); the header's primary follows the tab.
  await page.goto("/admin/profile-migrations");
  await expect(page).toHaveURL(/\/admin\/embedding-profiles\?tab=migrations$/);
  await expect(page.getByRole("heading", { level: 1, name: "Embedding profiles" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Migrations", selected: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Migrate a knowledge base" }).first()).toBeVisible();
  await a11y(page);
  await page.getByRole("tab", { name: "Profiles" }).click();
  await expect(page.getByRole("table", { name: "Embedding profiles" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Migrate a knowledge base" })).toHaveCount(0);
  await a11y(page);
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

test("parsing: OCR is off by default, with each backend's state", async ({ as, a11y }) => {
  // Read-only here: turning OCR on changes the whole platform.
  const page = await as("admin");
  await page.goto("/admin/parsing");
  await expect(page.getByRole("heading", { level: 1, name: "Parsing & OCR" })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Read scanned pages and images with OCR/ })).not.toBeChecked();
  await expect(page.getByText("Not configured: set OCR_TESSERACT_URL.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Test" })).toBeVisible();
  // Failed and needs-OCR documents by team and source (other specs' documents may be listed, or none).
  await expect(page.getByRole("heading", { name: "Documents that failed or need OCR" })).toBeVisible();
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
  await expect(page).toHaveURL(/tab=dry-run/);
  const report = page.getByRole("table", { name: "What retention would delete now" });
  await expect(report.getByRole("row").nth(1)).toBeVisible();
  await expect(page.getByText("Nothing is deleted by viewing this.")).toBeVisible();
  await a11y(page);

  // Legal holds is a tab of Retention (v0.2.1 I1), with Place a hold as the header's primary.
  await page.getByRole("tab", { name: "Legal holds" }).click();
  await expect(page).toHaveURL(/tab=holds/);
  await expect(page.getByRole("table", { name: "Legal holds" })).toBeVisible();
  await a11y(page);
  // One primary: the header's (an empty list doesn't repeat it).
  await expect(page.getByRole("button", { name: "Place a hold" })).toHaveCount(1);
  await page.getByRole("button", { name: "Place a hold" }).click();
  const place = page.getByRole("dialog", { name: "Place a legal hold" });
  await place.getByLabel("Covers").selectOption({ label: "Team" });
  // A team picker, not a slug to type.
  await place.getByRole("combobox", { name: "Team" }).fill(`E2E ${team}`);
  await page.getByRole("option", { name: new RegExp(`E2E ${team}`) }).click();
  await place.getByLabel("Reason").fill("E2E: litigation hold on this team's records");
  await a11y(page, "place a legal hold");
  await place.getByRole("button", { name: "Place hold" }).click();
  await expect(page.getByText(/^Hold placed on/)).toBeVisible();

  const row = page.getByRole("row", { name: new RegExp(`E2E ${team}`) });
  await expect(row).toBeVisible();
  await row.getByRole("rowheader").click();
  // Named by the team and the day it was placed.
  const sheet = page.getByRole("region", { name: new RegExp(`^Hold on E2E ${team}, placed `) });
  await expect(sheet).toBeVisible();
  await a11y(page, "legal hold record");
  await sheet.getByRole("button", { name: "Release hold" }).click();
  const release = page.getByRole("dialog", { name: /^Release the hold on/ });
  await release.getByLabel("Why release it").fill("E2E: the matter is closed");
  await a11y(page, "release a legal hold");
  await release.getByRole("button", { name: "Release hold" }).click();
  await expect(page.getByText("Hold released")).toBeVisible();
  // The Release button is gone: focus is on the record's heading.
  await expect(sheet.getByRole("heading", { level: 1 })).toBeFocused();

  // The hold's page: its back link returns to the list.
  await sheet.getByRole("link", { name: /^Back to/ }).click();
  await page.getByRole("group", { name: "Status" }).getByRole("button", { name: /^Released/ }).click();
  await expect(page).toHaveURL(/status=released/);
  await expect(page.getByRole("row", { name: new RegExp(`E2E ${team}`) })).toBeVisible();
  await a11y(page);

  // The old address redirects to the tab, its Released tab to the Status filter; without a tab, every hold (the tab's default).
  await page.goto("/admin/legal-holds");
  await expect(page).toHaveURL(/\/admin\/retention\?tab=holds$/);
  // The Dry run's old address redirects to its own.
  await page.goto("/admin/retention?tab=report");
  await expect(page).toHaveURL(/\/admin\/retention\?tab=dry-run$/);
  await page.goto("/admin/legal-holds?tab=released");
  await expect(page).toHaveURL(/\/admin\/retention\?tab=holds&status=released$/);
  await expect(page.getByRole("tab", { name: "Legal holds", selected: true })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`E2E ${team}`) })).toBeVisible();
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

  // The session's page: read the team's documents under it.
  const sheet = page.getByRole("region", { name: `Break-glass: E2E ${team}` });
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
