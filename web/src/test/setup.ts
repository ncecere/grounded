import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import * as matchers from "vitest-axe/matchers";
import { afterEach, expect } from "vitest";
import { scaled } from "../../test-scale";

expect.extend(matchers);
// findBy*/waitFor retry for up to 5 s instead of 1 s: on a loaded CI runner a
// page can take longer than 1 s to render after its queries resolve. It only
// waits when the element isn't there yet, so fast runs are no slower.
configure({ asyncUtilTimeout: scaled(5000) }); // times TEST_TIME_SCALE, 1 unless set (test-scale.ts)
afterEach(() => cleanup());

// axe's "label-content-name-mismatch" (WCAG 2.5.3, Label in Name) draws text on a canvas to tell icon fonts from words;
// jsdom has no canvas, so the rule came back "incomplete" and every vitest axe check skipped it. This minimal context
// says "this is ordinary text" so the rule runs on the markup: a button named "Paused, 0" around the text "Paused0"
// fails here, not only in the e2e suite's real browser.
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
  const ink = () => ({ data: new Uint8ClampedArray(4096).fill(255) });
  return { canvas: this, measureText: () => ({ width: 30 }), fillText() {}, clearRect() {}, getImageData: ink } as unknown as CanvasRenderingContext2D;
} as unknown as HTMLCanvasElement["getContext"];
