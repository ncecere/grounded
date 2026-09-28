import { Api, type Schemas } from "../support/api";
import { createTeam, handbook } from "../support/arrange";
import { expect, test } from "../support/fixtures";

/*
 * Maintenance mode pauses ingestion for every team, so this spec is in the
 * "platform" project, which runs after the parallel specs, one at a time.
 */

test.afterEach(async ({ admin }) => {
  // Never leave the platform paused for the next spec, whatever happened.
  const st = await admin.get<Schemas["MaintenanceSettings"]>("/v1/admin/settings/maintenance");
  if (st.enabled) await admin.putRevised("/v1/admin/settings/maintenance", { enabled: false });
});

test("maintenance mode: on pauses uploads with a banner; off resumes them", async ({ as, admin, a11y }) => {
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "maint" });
  const src = await owner.post<Schemas["DataSource"]>(`/v1/teams/${team}/sources`, { name: "Handbook", classification: "open" });
  await owner.upload(team, src.id, [handbook]);
  await owner.dispose();
  const reason = "E2E: moving to a new embedding model";

  const adminPage = await as("admin");
  await test.step("an admin turns it on", async () => {
    await adminPage.goto("/admin/maintenance");
    await expect(adminPage.getByRole("heading", { level: 1, name: "Maintenance" })).toBeVisible();
    await a11y(adminPage);
    await adminPage.getByRole("switch", { name: "Pause ingestion" }).click();
    await adminPage.getByLabel("Reason").fill(reason);
    await a11y(adminPage, "maintenance form");
    await adminPage.getByRole("button", { name: "Turn on maintenance mode" }).click();
    const confirm = adminPage.getByRole("alertdialog", { name: "Turn on maintenance mode?" });
    await a11y(adminPage, "maintenance confirmation");
    await confirm.getByRole("button", { name: "Turn on maintenance mode" }).click();
    // The toast can exist twice (the visible toast and its screen-reader
    // copy) on a slow runner: assert on the visible one.
    await expect(adminPage.getByText("Maintenance mode is on").filter({ visible: true }).first()).toBeVisible();
    await expect(adminPage.getByText("Maintenance: ingestion is paused")).toBeVisible();
  });

  const page = await as("alex");
  await test.step("a team owner sees the banner, and uploading is disabled", async () => {
    await page.goto(`/teams/${team}/sources/${src.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Handbook" })).toBeVisible();
    await expect(page.getByText("Maintenance: ingestion is paused")).toBeVisible();
    await expect(page.getByText(reason).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload files" })).toBeDisabled();
    await a11y(page, "source during maintenance");
  });

  await test.step("the admin turns it off", async () => {
    await adminPage.getByRole("switch", { name: "Pause ingestion" }).click();
    await adminPage.getByRole("button", { name: "Turn off maintenance mode" }).click();
    await expect(adminPage.getByText("Maintenance mode is off").filter({ visible: true }).first()).toBeVisible();
    await a11y(adminPage, "maintenance off");
  });

  await test.step("uploading works again, without the banner", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Handbook" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload files" })).toBeEnabled();
    await expect(page.getByText("Maintenance: ingestion is paused")).toHaveCount(0);
    await a11y(page);
  });
});
