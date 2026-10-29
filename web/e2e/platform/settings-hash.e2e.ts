import { expect, test } from "../support/fixtures";

// Settings data above the anchor arrives asynchronously. Gate that response,
// rather than adding a timing sleep, to exercise both a cold entry and reload.
for (const width of [1280, 390]) {
  for (const account of ["admin", "auditor"] as const) {
    test(`Settings #features survives deferred layout and reload (${account}, ${width}px)`, async ({ as, a11y }, info) => {
      const page = await as(account);
      await page.setViewportSize({ width, height: 900 });
      for (const navigation of ["entry", "reload"] as const) {
        let arrived!: () => void;
        let release!: () => void;
        const requested = new Promise<void>((resolve) => { arrived = resolve; });
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const pattern = "**/v1/admin/costs/settings";
        await page.route(pattern, async (route) => {
          arrived();
          await gate;
          await route.continue();
        });
        try {
          if (navigation === "entry") await page.goto("/admin/settings#features", { waitUntil: "domcontentloaded" });
          else await page.reload({ waitUntil: "domcontentloaded" });
          await requested;
          await expect(page.getByText("Loading settings…", { exact: true })).toBeAttached();
          release();
          await expect(page.getByRole("textbox", { name: "Currency", exact: true })).toBeAttached();
          const heading = page.getByRole("heading", { level: 2, name: "Features", exact: true });
          await expect(heading).toBeInViewport({ ratio: 1 });
          await a11y(page, `settings-${navigation}-${width}`);
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
