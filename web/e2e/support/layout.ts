import type { Frame, Locator, Page } from "@playwright/test";

/**
 * Where the chat composer is cut off (BU-19 on the chat page, the public page and the widget): every ancestor that
 * clips its overflow, and the window, must leave room for its outline and focus ring (3 px) on the sides and below.
 * Returns the clipping elements' names; [] when nothing cuts it.
 */
export async function composerClips(where: Page | Frame): Promise<string[]> {
  return where.evaluate(() => {
    const form = document.querySelector("form textarea")?.closest("form");
    if (!form) return ["no composer"];
    const r = form.getBoundingClientRect();
    const ring = 3;
    const out: string[] = [];
    for (let el = form.parentElement; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const b = el.getBoundingClientRect();
      if (r.left - ring < b.left || r.right + ring > b.right || r.bottom + ring > b.bottom) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
    }
    if (r.left - ring < 0 || r.right + ring > innerWidth || r.bottom + ring > innerHeight) out.push("window");
    return out;
  });
}

/**
 * What makes `target` scroll sideways: the element itself and every ancestor whose content is wider than its box (where it clips or scrolls),
 * and the document when the page is wider than the window. Returns their names; [] when everything fits. (#140: a table behind sideways
 * scrolling on a phone, its Status clipped.)
 */
export async function sidewaysScroll(page: Page, target: Locator): Promise<string[]> {
  const handle = await target.elementHandle();
  if (!handle) return ["no such element"];
  return page.evaluate((el) => {
    const out: string[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const clips = cs.overflowX !== "visible" || e === document.documentElement;
      if (clips && e.scrollWidth > e.clientWidth + 1) {
        out.push(`${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} (${e.scrollWidth} > ${e.clientWidth})`);
        // What sticks out, to say where the width comes from.
        const edge = e.getBoundingClientRect().right;
        for (const d of Array.from(e.querySelectorAll("*")).filter((x) => x.getBoundingClientRect().right > edge + 1).slice(0, 4)) {
          out.push(`  ${d.tagName.toLowerCase()}.${String(d.className).split(" ")[0]} "${(d.textContent ?? "").trim().slice(0, 30)}" right=${Math.round(d.getBoundingClientRect().right)} > ${Math.round(edge)}`);
        }
      }
    }
    return out;
  }, handle);
}
