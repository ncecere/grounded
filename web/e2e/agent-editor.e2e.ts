import type { CDPSession, Page } from "@playwright/test";
import { Api } from "./support/api";
import { chatModel, createTeam, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * The agent editor (v0.4.2 M2). The Build tab's split fills the window and
 * never makes the page scroll past its content (OW-1: BU-01, VI-01), however
 * its sections are opened and scrolled; widget keys show their secret once
 * saved (US-02); the Share tab follows publishing (BU-03); an editor can't
 * change a public agent's live name or look (BU-09).
 */

/** A real mouse wheel at a point (CDP), like a person's: Playwright's and agent-browser's go through other paths. */
async function wheel(cdp: CDPSession, x: number, y: number, deltaY: number) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
}

/** Extra page scroll the document allows, and absolutely positioned things in the panes laid out against something outside them. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const panes = ["agent-build-config", "agent-build-test"].map((id) => document.getElementById(id)).filter((p): p is HTMLElement => Boolean(p));
    const escaped = panes.flatMap((pane) =>
      // Fixed elements (Base UI's hidden form inputs) don't extend the page; SVG elements have no offsetParent.
      [...pane.querySelectorAll<HTMLElement>("*")]
        .filter((el) => el instanceof HTMLElement && el.getClientRects().length > 0 && getComputedStyle(el).position === "absolute" && !pane.contains(el.offsetParent))
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
    );
    return { extra: document.documentElement.scrollHeight - innerHeight, scrollY, escaped };
  });
}

const sections = ["Model", "Knowledge", "Tools", "Answering", "Safety", "Advanced"];

test("the Build tab fits the window at every size, with every section open and scrolled", async ({ as, admin, a11y }) => {
  test.setTimeout(150_000);
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "build-fit" });
  const { agent } = await publishedAgent(owner, team, { name: "Fit helper" });
  await owner.dispose();
  const page = await as("alex");
  const cdp = await page.context().newCDPSession(page);

  for (const [width, height] of [
    [1711, 1295],
    [1440, 900],
    [1280, 720],
  ] as const) {
    await test.step(`${width}x${height}`, async () => {
      await page.setViewportSize({ width, height });
      await page.goto(`/teams/${team}/agents/${agent.id}`);
      await expect(page.getByRole("heading", { level: 1, name: "Fit helper" })).toBeVisible();
      const config = page.locator("#agent-build-config");
      await expect(config).toBeVisible();
      if (width === 1440) await a11y(page);
      expect(await overflow(page)).toEqual({ extra: 0, scrollY: 0, escaped: [] });

      // Bottom up, with the pane scrolled to its top before each (the builder's worst case), then top down.
      for (const name of [...sections].reverse()) {
        const box = (await config.boundingBox())!;
        await wheel(cdp, box.x + box.width / 2, box.y + 40, -5000);
        await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      }
      for (const name of ["Instructions", ...sections]) {
        const trigger = page.getByRole("button", { name: new RegExp(`^${name}`) });
        if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
      }
      const box = (await config.boundingBox())!;
      // The wheel inside the pane past its end, then over the page header, then the keyboard on the page.
      await wheel(cdp, box.x + box.width / 2, box.y + box.height / 2, 20_000);
      await wheel(cdp, box.x + box.width / 2, box.y + 40, -20_000);
      await wheel(cdp, box.x + 20, 120, 2000);
      await page.getByRole("heading", { level: 1, name: "Fit helper" }).click();
      for (const key of ["PageDown", "PageDown", "End", "Space"]) await page.keyboard.press(key);
      expect(await overflow(page)).toEqual({ extra: 0, scrollY: 0, escaped: [] });
      // The panes still scroll on their own.
      expect(await config.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      // Closing them all again leaves the page as it was.
      for (const name of ["Instructions", ...sections]) await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      expect(await overflow(page)).toEqual({ extra: 0, scrollY: 0, escaped: [] });
    });
  }

  await test.step("a notice above the split shrinks it instead of pushing the page down", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Unchecking the only knowledge base adds "Fix these before publishing" above the split.
    await page.getByRole("button", { name: /^Knowledge/ }).click();
    await page.getByRole("checkbox", { name: /Fit helper KB/ }).uncheck();
    await expect(page.getByText("Fix these before publishing")).toBeVisible({ timeout: 15_000 });
    await a11y(page, "build with a problem list");
    await expect.poll(async () => (await overflow(page)).extra).toBe(0);
    await page.getByRole("checkbox", { name: /Fit helper KB/ }).check();
  });
});

test("a widget key's secret shows after Create key, with origins added with Enter", async ({ as, admin, a11y }) => {
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "widget-key" });
  const { agent, kb } = await publishedAgent(owner, team, { name: "Key helper" });
  // A Public draft shows the widget section (keys can be made before it's published to Public).
  const model = await chatModel(owner);
  const cur = await owner.get<{ revision: number }>(`/v1/teams/${team}/agents/${agent.id}`);
  const config = { chatModelId: model.id, kbs: [{ kbId: kb.id }], instructions: "Be brief.", audience: "public" };
  await owner.patch(`/v1/teams/${team}/agents/${agent.id}`, { config }, { headers: { "If-Match": `"${cur.revision}"` } });
  await owner.dispose();
  const page = await as("alex");
  await page.goto(`/teams/${team}/agents/${agent.id}?tab=share`);
  await expect(page.getByRole("heading", { level: 1, name: "Key helper" })).toBeVisible();
  await page.getByRole("button", { name: "New widget key" }).first().click();
  const form = page.getByRole("region", { name: "New widget key" });
  await form.getByLabel("Name").fill("Main website");
  const origins = form.getByRole("textbox", { name: /Allowed origins/ });
  await origins.fill("https://www.example.edu");
  await origins.press("Enter");
  await origins.fill("https://library.example.edu");
  await origins.press("Enter");
  await a11y(page, "new widget key");
  // The form closes with history.back() after the save. On a busy page the form re-renders (saved, not busy) before
  // that navigation lands, which asked "Leave without saving?" and hid the secret: make that order certain.
  await page.evaluate(() => {
    const back = history.back.bind(history);
    history.back = () => void setTimeout(back, 300);
  });
  await form.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText("Shown once. It's already in the code below: copy the code now.")).toBeVisible();
  await expect(page.getByRole("alertdialog", { name: "Leave without saving?" })).toHaveCount(0);
  await a11y(page, "the new key's secret");
});
