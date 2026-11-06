import { expect, test } from "./support/fixtures";
import { createTeam } from "./support/arrange";
import type { Schemas } from "./support/api";
import { scaled } from "../test-scale";

// Document permissions (docs/document-permissions.md): the platform switch in Features, then a source's Access tab
// restricting it to a group, the Restricted badges, and back to everyone. The switch is put back off at the end, so
// other specs see the default.
test("document permissions: the switch, a source's Access tab and the Restricted badges", async ({ admin, as, a11y }, info) => {
  test.setTimeout(scaled(120_000));
  const team = await createTeam(admin, admin, { prefix: "access" });
  const base = `/v1/teams/${team}`;
  const source = await admin.post<Schemas["DataSource"]>(`${base}/sources`, { name: "HR policies", classification: "open" });
  await admin.upload(team, source.id, [{ name: "leave.md", body: "# Leave\n\nStaff request annual leave in the HR portal two weeks ahead.\n" }]);
  await expect.poll(async () => (await admin.get<Schemas["DocumentPage"]>(`${base}/sources/${source.id}/documents`)).items.map((d) => d.status), { timeout: scaled(30_000) }).toEqual(["ready"]);

  const page = await as("admin");
  await page.goto("/admin/settings?tab=features");
  const toggle = page.getByRole("switch", { name: "Allow document permissions" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await a11y(page);

  try {
    await page.goto(`/teams/${team}/sources/${source.id}?tab=access`);
    await page.getByRole("radio", { name: /Only some groups and people/ }).check();
    await page.getByRole("textbox", { name: "Groups" }).fill("hr-staff");
    await page.keyboard.press("Enter");
    await a11y(page);
    await page.getByRole("button", { name: "Save access" }).click();
    await expect(page.getByText(/only the groups and people you chose can read this source/)).toBeVisible();
    await expect(page.getByTitle("Restricted to 1 group or person")).toBeVisible();
    await page.screenshot({ path: info.outputPath("source-access-restricted.png"), fullPage: true });

    await page.goto(`/teams/${team}/sources/${source.id}?tab=documents`);
    await expect(page.getByRole("table").getByText("Restricted")).toBeVisible();
    await a11y(page);

    await page.goto(`/teams/${team}/sources/${source.id}?tab=access`);
    await page.getByRole("radio", { name: /Everyone who can use the knowledge/ }).check();
    await page.getByRole("button", { name: "Save access" }).click();
    await expect(page.getByText(/everyone who can use the knowledge can read this source/)).toBeVisible();
  } finally {
    const src = await admin.get<Schemas["DataSource"]>(`${base}/sources/${source.id}`);
    if (src.access?.restricted) await admin.put(`${base}/sources/${source.id}/access`, { principals: null }, { headers: { "If-Match": `"${src.revision}"` } });
    await admin.putRevised("/v1/admin/document-access", { enabled: false });
  }
});
