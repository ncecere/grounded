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
});
