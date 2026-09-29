import { Api } from "./support/api";
import { createTeam } from "./support/arrange";
import { expect, test } from "./support/fixtures";

test("signs in with a development persona and out again", async ({ page, a11y }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await a11y(page, "sign-in page");

  await page.getByRole("button", { name: /Casey Dev/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome, Casey" })).toBeVisible();
  await expect(page).toHaveTitle(/Home/);
  await a11y(page, "home");

  await page.getByRole("button", { name: /^Account: Casey Dev/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("workspace shell: sidebar, breadcrumbs and ⌘K navigation", async ({ as, admin, a11y }) => {
  const alex = await Api.signIn("alex");
  const team = await createTeam(admin, alex, { prefix: "shell" });
  await alex.dispose();

  const page = await as("alex");
  await page.goto(`/teams/${team}`);
  await expect(page.getByRole("heading", { level: 1, name: `E2E ${team}` })).toBeVisible();
  await expect(page.getByRole("button", { name: `Current workspace: E2E ${team} Owner` })).toBeVisible();
  await a11y(page);
  // The first Tab reaches the skip link, not the sidebar item after the current page (keeping it in view mustn't move the Tab start).
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

  // The sidebar.
  const sidebar = page.getByRole("navigation", { name: "Main" });
  await sidebar.getByRole("link", { name: "Data sources" }).click();
  await expect(page).toHaveURL(`/teams/${team}/sources`);
  await expect(page.getByRole("heading", { level: 1, name: "Data sources" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: `E2E ${team}` })).toBeVisible();
  await a11y(page);

  // The command palette, from the keyboard.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("combobox", { name: "Command palette" });
  await expect(search).toBeFocused();
  await a11y(page, "command palette");
  await search.fill("Knowledge bases");
  await palette.getByRole("option", { name: `Knowledge bases E2E ${team}` }).click();
  await expect(page).toHaveURL(`/teams/${team}/kbs`);
  await expect(palette).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge bases" })).toBeVisible();
  await a11y(page);

  // ... and from the header's search button, with the keyboard only.
  await page.getByRole("button", { name: "Search or jump to…" }).click();
  // Type only once the palette has focus, or the first keys go to the page.
  await expect(search).toBeFocused();
  await page.keyboard.type("Discover agents");
  await expect(palette.getByRole("option").first()).toHaveAccessibleName(/^Discover agents/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/agents");
  await expect(page.getByRole("heading", { level: 1, name: "Discover agents" })).toBeVisible();
  await a11y(page);

  // Collapsing the sidebar keeps the navigation reachable.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
  await a11y(page, "collapsed sidebar");
  await page.getByRole("button", { name: "Expand sidebar" }).click();
});
