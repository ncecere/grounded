import { Api, type Schemas } from "./support/api";
import { createTeam, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * The team workspace after v0.2.1's moves (docs/v0.2.1.md I3, I4, I6): the
 * Overview's Quality & spend, the team's Evaluations page and sidebar item,
 * Team settings' Usage & spend, Crawl domains on Data sources, and the agent
 * editor's version menu. (The old addresses' redirects are tested in vitest:
 * moved-v021.test.tsx, agent-versions.test.tsx.) The team tracks costs with
 * its own mode, so the platform stays Off and other specs are unaffected.
 */
test("quality and spend, crawl domains on Data sources, and the agent's version menu", async ({ as, admin, a11y }) => {
  test.setTimeout(120_000);
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "v021" });
  const { agent, kb } = await publishedAgent(owner, team, { name: "Quality helper" });
  const base = `/v1/teams/${team}`;
  const set = await owner.post<Schemas["EvaluationSet"]>(`${base}/evaluation-sets`, { kbId: kb.id, name: "Parking questions" });
  await owner.dispose();
  await admin.putRevised(`/v1/admin/teams/${team}/budget`, { mode: "track", amount: "5", warnPercent: null });
  const page = await as("alex");

  await test.step("the Overview's Quality & spend", async () => {
    await page.goto(`/teams/${team}`);
    const row = page.getByRole("region", { name: "Quality & spend" });
    await expect(row.getByRole("table", { name: "Latest evaluation scores" }).getByRole("link", { name: "Parking questions" })).toBeVisible();
    await expect(row.getByText(/this month · Within budget · not enforced · resets/)).toBeVisible();
    await a11y(page);
    await row.getByRole("link", { name: "All evaluations" }).click();
    await expect(page).toHaveURL(`/teams/${team}/evaluations`);
  });

  await test.step("the team's Evaluations page, from the sidebar", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Evaluations" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Evaluations" })).toHaveAttribute("aria-current", "page");
    const table = page.getByRole("table", { name: "Evaluation sets" });
    await expect(table.getByRole("link", { name: "Parking questions" })).toHaveAttribute("href", `/teams/${team}/evaluations/${set.id}`);
    // "Not run yet" as the score, and the trend's text for screen readers.
    await expect(table.getByText("Not run yet").first()).toBeVisible();
    await a11y(page);
    await table.getByRole("link", { name: "Parking questions" }).click();
    // The set sits under the team's Evaluations page in the breadcrumb, and it leads back there.
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("listitem")).toHaveText([`E2E ${team}`, "Evaluations", "Parking questions"]);
    await a11y(page);
    await crumbs.getByRole("link", { name: "Evaluations" }).click();
    await expect(page).toHaveURL(`/teams/${team}/evaluations`);
  });

  await test.step("Usage & spend in Team settings", async () => {
    await page.goto(`/teams/${team}/settings?tab=usage`);
    await expect(page.getByRole("tab", { name: "Usage & spend", selected: true })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Team settings sections" }).getByRole("tab");
    await expect(tabs).toHaveText(["Members", "Usage & spend", "API keys", "Audit log", "General"]);
    await expect(page.getByRole("meter", { name: "Share of this month's budget used" })).toBeVisible();
    await a11y(page);
  });

  await test.step("Crawl domains on Data sources", async () => {
    await page.goto(`/teams/${team}/sources`);
    await expect(page.getByRole("tab", { name: "Sources", selected: true })).toBeVisible();
    await a11y(page);
    await page.getByRole("tab", { name: "Crawl domains" }).click();
    await expect(page).toHaveURL(`/teams/${team}/sources?tab=crawl-domains`);
    await expect(page.getByRole("button", { name: "Request a domain" })).toBeVisible();
    await a11y(page);
  });

  await test.step("the agent's version menu and history", async () => {
    await page.goto(`/teams/${team}/agents/${agent.id}`);
    await expect(page.getByRole("tablist", { name: "Agent sections" }).getByRole("tab")).toHaveText(["Build", "Evaluations", "Appearance", "Share", "Analytics", "Settings"]);
    await page.getByRole("button", { name: "v1 live" }).click();
    await a11y(page, "version menu");
    await page.getByRole("menuitem", { name: "Version history" }).click();
    await expect(page).toHaveURL(/history=versions/);
    const history = page.getByRole("region", { name: "Version history" });
    await expect(history.getByRole("table", { name: "Published versions" })).toContainText("E2E");
    await a11y(page);
  });
});
