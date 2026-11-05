import { expect, test } from "../support/fixtures";

// Admin → Settings is in pill tabs; links made before them point at #features. Such a link, on entry and after a reload,
// opens the Features tab (with the general settings' data arriving late, gated rather than slept on).
for (const width of [1280, 390]) {
  for (const account of ["admin", "auditor"] as const) {
    test(`an old Settings #features link opens the Features tab (${account}, ${width}px)`, async ({ as, a11y }, info) => {
      const page = await as(account);
      await page.setViewportSize({ width, height: 900 });
      for (const navigation of ["entry", "reload"] as const) {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const pattern = "**/v1/admin/costs/settings";
        await page.route(pattern, async (route) => {
          await gate;
          await route.continue();
        });
        try {
          if (navigation === "entry") await page.goto("/admin/settings#features", { waitUntil: "domcontentloaded" });
          else await page.reload({ waitUntil: "domcontentloaded" });
          await expect(page.getByRole("tab", { name: "Features", exact: true })).toHaveAttribute("aria-selected", "true");
          await expect(page).toHaveURL(/\?tab=features/);
          release();
          const heading = page.getByRole("heading", { level: 2, name: "Features", exact: true });
          await expect(heading).toBeVisible();
          await expect(page.getByRole("switch", { name: "Allow evaluations" })).toBeVisible();
          await a11y(page, `settings-features-${navigation}-${width}`);
          const screenshot = info.outputPath(`features-${navigation}-${account}-${width}.png`);
          await page.screenshot({ path: screenshot });
          await info.attach(`Features ${navigation} ${account} ${width}`, { path: screenshot, contentType: "image/png" });
        } finally {
          release();
          await page.unroute(pattern);
        }
      }
    });
  }
}
