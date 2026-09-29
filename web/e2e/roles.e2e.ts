import { Api } from "./support/api";
import { createTeam } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/* What the UI shows each role (DESIGN §3.5); the API enforces the same rules. */

test("a team member doesn't see Usage or the audit log in Team settings", async ({ as, admin, a11y }) => {
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "roles", members: { blair: "member", casey: "editor" } });
  await owner.dispose();

  const member = await as("blair");
  await member.goto(`/teams/${team}/settings`);
  await expect(member.getByRole("heading", { level: 1, name: "Team settings" })).toBeVisible();
  const tabs = member.getByRole("tablist", { name: "Team settings sections" });
  await expect(tabs.getByRole("tab", { name: "Members" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "API keys" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Usage & limits" })).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "Audit log" })).toHaveCount(0);
  await expect(member.getByRole("button", { name: "Add member" })).toHaveCount(0);
  await a11y(member);

  // Addresses of the hidden tabs don't show them either.
  for (const tab of ["usage", "audit"]) {
    await member.goto(`/teams/${team}/settings?tab=${tab}`);
    await expect(tabs.getByRole("tab", { name: "Members" })).toHaveAttribute("aria-selected", "true");
    // The address is rewritten to the tab shown.
    await expect(member).toHaveURL(`/teams/${team}/settings`);
    await expect(member.getByRole("meter")).toHaveCount(0);
    await expect(member.getByRole("table", { name: /audit/i })).toHaveCount(0);
    await a11y(member);
  }

  // An editor reads both.
  const editor = await as("casey");
  await editor.goto(`/teams/${team}/settings?tab=usage`);
  await expect(editor.getByRole("tab", { name: "Usage & limits" })).toHaveAttribute("aria-selected", "true");
  await expect(editor.getByRole("tab", { name: "Audit log" })).toBeVisible();
  await a11y(editor);
});

test("only platform staff open the admin portal", async ({ as, a11y }) => {
  const user = await as("user");
  const adminCalls: string[] = [];
  user.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/v1/admin/")) adminCalls.push(r.url());
  });
  await user.goto("/");
  await expect(user.getByRole("heading", { level: 1, name: /^Welcome/ })).toBeVisible();
  await expect(user.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  await a11y(user);

  await user.goto("/admin/limits");
  await expect(user.getByRole("heading", { level: 1, name: "No access" })).toBeVisible();
  await expect(user.getByText("The admin portal is for platform admins and auditors.")).toBeVisible();
  await expect(user.getByRole("heading", { level: 1, name: "Limits" })).toHaveCount(0);
  await a11y(user, "admin page as a non-admin");
  expect(adminCalls).toEqual([]);

  // The auditor reads the portal.
  const auditor = await as("auditor");
  await auditor.goto("/admin");
  await expect(auditor.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await a11y(auditor);

  // On a phone the top bar fits: the Read-only badge keeps its word for screen readers but shows only its dot.
  await auditor.setViewportSize({ width: 390, height: 844 });
  await auditor.goto("/admin/limits");
  await expect(auditor.getByRole("heading", { level: 1, name: "Limits" })).toBeVisible();
  await expect(auditor.getByText("You can view these settings. Only platform admins can change them.")).toBeVisible();
  await expect(auditor.getByRole("button", { name: /Search or jump to/ })).toBeInViewport();
  expect(await auditor.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await a11y(auditor);
});
