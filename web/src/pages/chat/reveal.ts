/*
 * Going from a citation chip to its source card under the answer: the
 * sources list opens (its height animates), then the card is focused and
 * scrolled into view. Scrolling waits for the opening to finish, so the card
 * isn't left where it was mid-animation, behind the composer; the card's
 * scroll margin (answer.module.css) keeps it clear of the "Scroll to latest"
 * button over the bottom of the conversation (WCAG 2.4.11).
 */

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The animations (the list's opening) of el's ancestors that are still running. */
function running(el: HTMLElement): Animation[] {
  const out: Animation[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) out.push(...(p.getAnimations?.() ?? []).filter((a) => a.playState === "running"));
  return out;
}

/** Focuses the element with this id once it exists, then scrolls it into view when its list has finished opening. */
export async function revealSource(id: string, { highlightMs = 1500 } = {}) {
  let el = document.getElementById(id);
  for (let tries = 0; !el && tries < 20; tries++) {
    await frame();
    el = document.getElementById(id);
  }
  if (!el) return;
  el.focus({ preventScroll: true });
  el.setAttribute("data-highlighted", "");
  setTimeout(() => el.removeAttribute("data-highlighted"), highlightMs);
  // The opening starts on the next frames: wait for them, then for the animation.
  await frame();
  await frame();
  await Promise.allSettled(running(el).map((a) => a.finished));
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
}
