import type { Frame, Page } from "@playwright/test";

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
