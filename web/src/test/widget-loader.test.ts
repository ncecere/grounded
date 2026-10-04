/* The widget loader (web/widget/widget.ts): it asks Grounded before showing its launcher (docs/ui-review F-09). */
import { vi } from "vitest";

async function load(reply: unknown, status = 200) {
  vi.resetModules();
  document.body.innerHTML = "";
  const script = document.createElement("script");
  script.src = "https://rag.example.edu/widget.js";
  script.dataset.agent = "ag1";
  script.dataset.key = "pk_abc";
  Object.defineProperty(document, "currentScript", { value: script, configurable: true });
  const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ data: reply }), { status }));
  vi.stubGlobal("fetch", fetchMock);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await import("../../widget/widget");
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  return { fetchMock, warn };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("widget loader", () => {
  it("shows no launcher on a site the key doesn't allow, and warns the site owner", async () => {
    const { fetchMock, warn } = await load({ allowed: false, code: "origin_not_allowed", message: "This site is not allowed to embed this assistant." });
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/^https:\/\/rag\.example\.edu\/v1\/public\/agents\/ag1\/widget-check\?key=pk_abc&origin=/);
    expect(document.querySelector("[data-grounded-widget]")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("origin_not_allowed"));
  });

  it("shows the launcher when the check passes", async () => {
    const { warn } = await load({ allowed: true, code: null, message: null, name: "Registrar help", accentColor: "#0021a5" });
    await vi.waitFor(() => expect(document.querySelector("[data-grounded-widget]")).not.toBeNull());
    expect(warn).not.toHaveBeenCalled();
  });

  it("follows the host's system setting: in dark the launcher is ringed and the panel is dark (VI-38)", async () => {
    // The shadow root is closed; open it for the test.
    const attach = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, init: ShadowRootInit) {
      return attach.call(this, { ...init, mode: "open" });
    });
    await load({ allowed: true, code: null, message: null, name: "Registrar help", accentColor: "#343741" });
    await vi.waitFor(() => expect(document.querySelector("[data-grounded-widget]")).not.toBeNull());
    const css = document.querySelector("[data-grounded-widget]")!.shadowRoot!.querySelector("style")!.textContent!;
    const dark = css.slice(css.indexOf("@media (prefers-color-scheme:dark)"));
    expect(dark).toMatch(/\.l\{box-shadow:0 0 0 2px rgba\(255,255,255,\.85\)/);
    expect(dark).toMatch(/\.l:focus-visible\{outline-color:#fff\}/);
    expect(dark).toMatch(/\.p\{background:#0b0d12/);
    // The close button sits on the accent: its focus ring is white, never the accent itself.
    expect(css).toContain(".x:focus-visible{outline:2px solid #fff");
  });
});
