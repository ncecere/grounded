/*
 * The Build split's height (OW-1, BU-01, VI-01): from the split's own top to
 * the bottom of the window, less a small gap, so the page never scrolls past
 * its content whatever sits above it (notices, a wrapping Publish reason, a
 * problem list). A fixed formula (100dvh − top bar − 16rem) assumed a header
 * height and made the page taller than the window whenever it was taller.
 *
 * The shell keeps its bottom padding (main's) for other pages; here the
 * split pulls it in with a negative bottom margin, so the gap under the
 * split is `gap`. On a window too short for `min` the page scrolls, as it
 * must. Recomputed on resize and whenever anything around the split changes
 * size (a notice appears, the description wraps).
 */
import { type RefObject, useLayoutEffect } from "react";

type Options = {
  /** Smallest height in px (a shorter window scrolls the page instead). */
  min: number;
  /** Space under the split, in px. */
  gap: number;
};

/** Sets `--build-split-height` and a bottom margin on the element. */
export function useFillViewport(ref: RefObject<HTMLElement | null>, { min, gap }: Options) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const main = el.closest("main");
    const fit = () => {
      const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const pull = Math.max(0, pad - gap);
      const top = el.getBoundingClientRect().top + window.scrollY;
      const height = Math.max(min, Math.floor(window.innerHeight - top - gap));
      el.style.setProperty("--build-split-height", `${height}px`);
      el.style.marginBlockEnd = pull ? `-${pull}px` : "";
    };
    fit();
    // Anything above the split changing size moves its top: watch its ancestors up to main (they grow with it).
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(later);
    for (let node = el.parentElement; node && node !== main; node = node.parentElement) observer?.observe(node);
    window.addEventListener("resize", later);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", later);
      el.style.removeProperty("--build-split-height");
      el.style.marginBlockEnd = "";
    };
  }, [ref, min, gap]);
}
