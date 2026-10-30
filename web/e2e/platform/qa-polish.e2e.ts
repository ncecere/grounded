import { Api, type Schemas } from "../support/api";
import { createTeam, unique } from "../support/arrange";
import { expect, test } from "../support/fixtures";
import { sidewaysScroll } from "../support/layout";

/*
 * v0.6.0 QA polish (#140), as people see it: the requester's page shows the classification the reviewer approved (and what was asked for),
 * and on a 390px phone the Request a team, review queue and webhook tables fit without sideways scrolling and keep their Status; a very long
 * (but valid) host pattern wraps in the Approved destinations table instead of pushing Note and Approved off the screen. It changes the
 * team requests and webhooks switches, so it runs in the serial platform project and puts them back.
 */
test("the requester's page shows the approved classification, and the tables fit a 390px phone", async ({ as, admin, a11y }) => {
  test.setTimeout(180_000);
  const requester = await Api.signIn("user");
  for (const r of (await requester.get<Schemas["TeamRequestsOverview"]>("/v1/team-requests")).items.filter((i) => i.status === "pending")) {
    await requester.post(`/v1/team-requests/${r.id}/withdraw`);
  }
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "polish" });
  const longPattern = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.example.com`;
  const name = unique("E2E polish");
  await admin.putRevised("/v1/admin/settings/team-requests", { enabled: true, maxOpen: 5, allowedGroup: "" });
  await admin.putRevised("/v1/admin/settings/webhooks", { enabled: true });
  const approved: string[] = [];
  for (const pattern of ["*.example.com", longPattern]) {
    if (!(await admin.get<Schemas["WebhookDestination"][]>("/v1/webhook-destinations")).some((d) => d.pattern === pattern)) {
      approved.push((await admin.post<Schemas["WebhookDestination"]>("/v1/admin/webhook-destinations", { pattern, note: "E2E polish receiver, with a note long enough to need wrapping on a phone" })).id);
    }
  }
  const hook = await owner.post<Schemas["WebhookCreated"]>(`/v1/teams/${team}/webhooks`, {
    url: "https://hooks.example.com/polish", description: "E2E polish", events: ["agent.published", "source.synced", "source.sync_failed", "feedback.submitted"], enabled: true,
  });

  try {
    const asked = await requester.post<Schemas["TeamRequest"]>("/v1/team-requests", { name, purpose: "Run it.", classification: "open" });
    const pending = await admin.get<Schemas["AdminTeamRequest"]>(`/v1/admin/team-requests/${asked.id}`);
    await admin.post(
      `/v1/admin/team-requests/${asked.id}/approve`,
      { slug: unique("polish-req"), maxClassification: "sensitive" },
      { headers: { "If-Match": `"${pending.revision}"` } },
    );

    const person = await as("user");
    await test.step("at desktop width the page shows Sensitive, and what was asked for", async () => {
      await person.goto("/team-requests");
      const row = person.getByRole("table", { name: "Your team requests" }).getByRole("row", { name: new RegExp(name) });
      await expect(row).toContainText("Approved");
      await expect(row).toContainText("Sensitive");
      await expect(row).toContainText("Asked for Open");
      await a11y(person, "request a team: approved at another level");
    });

    await test.step("at 390px the table keeps the team and the status, and nothing scrolls sideways", async () => {
      await person.setViewportSize({ width: 390, height: 844 });
      await person.goto("/team-requests");
      const table = person.getByRole("table", { name: "Your team requests" });
      const row = table.getByRole("row", { name: new RegExp(name) });
      await expect(row).toContainText("Approved");
      expect(await sidewaysScroll(person, table)).toEqual([]);
      const pill = await row.getByText("Approved", { exact: true }).boundingBox();
      expect(pill && pill.x >= 0 && pill.x + pill.width <= 390, `the Status pill is within the window: ${JSON.stringify(pill)}`).toBe(true);
      await a11y(person, "request a team at 390px");
    });

    const platform = await as("admin");
    await platform.setViewportSize({ width: 390, height: 844 });
    await test.step("at 390px the review queue fits too", async () => {
      await platform.goto("/admin/teams?tab=requests");
      const table = platform.getByRole("table", { name: "Team requests" });
      await expect(table.getByRole("row", { name: new RegExp(name) })).toContainText("Approved");
      expect(await sidewaysScroll(platform, table)).toEqual([]);
      await a11y(platform, "team requests queue at 390px");
    });

    await test.step("at 390px a team's webhooks keep the address and the status", async () => {
      const ownerPage = await as("alex");
      await ownerPage.setViewportSize({ width: 390, height: 844 });
      await ownerPage.goto(`/teams/${team}/settings?tab=webhooks`);
      const table = ownerPage.getByRole("table", { name: "Team webhooks" });
      const row = table.getByRole("row", { name: /hooks\.example\.com\/polish/ });
      await expect(row).toContainText("On");
      expect(await sidewaysScroll(ownerPage, table)).toEqual([]);
      const pill = await row.getByText("On", { exact: true }).boundingBox();
      expect(pill && pill.x >= 0 && pill.x + pill.width <= 390, `the Status pill is within the window: ${JSON.stringify(pill)}`).toBe(true);
      await a11y(ownerPage, "team webhooks at 390px");
    });

    await test.step("a 195-character pattern wraps in the destinations table, at 1280px and at 390px", async () => {
      for (const width of [1280, 390]) {
        await platform.setViewportSize({ width, height: 900 });
        await platform.goto("/admin/webhooks");
        const table = platform.getByRole("table", { name: "Approved destinations" });
        const row = table.getByRole("row", { name: new RegExp(longPattern.slice(0, 20)) });
        await expect(row).toBeVisible();
        await expect(row).toContainText("E2E polish receiver");
        expect(await sidewaysScroll(platform, table), `at ${width}px`).toEqual([]);
        await a11y(platform, `admin webhooks at ${width}px`);
      }
    });
  } finally {
    await owner.del(`/v1/teams/${team}/webhooks/${hook.webhook.id}`);
    for (const id of approved) await admin.del(`/v1/admin/webhook-destinations/${id}`);
    await admin.putRevised("/v1/admin/settings/webhooks", { enabled: false });
    await admin.putRevised("/v1/admin/settings/team-requests", { enabled: false, maxOpen: 2, allowedGroup: "" });
    await requester.dispose();
    await owner.dispose();
  }
});
