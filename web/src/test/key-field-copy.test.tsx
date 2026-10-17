/* #146: the Key field of Add model and Add profile says what a key is in the app's words, not the browser's "Please match the requested format." */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { keyProblem } from "../lib/validation";
import { mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const copy = "Use lowercase letters, digits, dots, hyphens and underscores, starting with a letter or digit (63 characters at most).";
const conn = { id: "c1", name: "Gateway", baseUrl: "http://gateway.example.edu/v1", enabled: true, modelCount: 0, revision: 1, timeoutSeconds: 60, maxConcurrentRequests: 8 };
const embed = { id: "m2", connectionId: "c1", key: "nomic", upstreamModel: "nomic", displayName: "Nomic", kind: "embedding", maxClassification: "open", enabled: true, dimensions: 768, compat: {}, revision: 1, createdAt: "", updatedAt: "" };

describe("keyProblem (catalog.keyRE: ^[a-z0-9][a-z0-9._-]{0,62}$)", () => {
  it.each(["a", "0", "gpt-oss", "qwen3.5_32b", "a.b-c_d", "a".repeat(63)])("accepts %s", (k) => expect(keyProblem(k)).toBeNull());
  it.each(["Bad", "has space", "-lead", ".lead", "_lead", "a/b", "é", "a".repeat(64)])("refuses %s with the app's copy", (k) => expect(keyProblem(k)).toBe(copy));
  it("asks for a key when empty", () => expect(keyProblem("")).toBe("Enter a key."));
});

describe("the Key field's message", () => {
  it("Add model shows the app's copy for a key the server would refuse", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/connections": () => [conn], "GET /v1/admin/models": () => [], "POST /v1/admin/connections/c1/test": () => ({ ok: true, latencyMs: 5, probe: "models", models: ["m"] }) });
    renderApp("/admin/models?form=new");
    await screen.findByRole("combobox", { name: "Connection" }, { timeout: scaled(4000) });
    await user.type(screen.getByRole("combobox", { name: "Upstream model ID" }), "some-model");
    await user.type(screen.getByRole("textbox", { name: "Display name" }), "Some model");
    const key = screen.getByRole("textbox", { name: "Key" });
    await user.clear(key);
    await user.type(key, "Bad Key");
    await user.click(screen.getByRole("button", { name: "Add model" }));
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(screen.queryByText(/match the requested format/i)).toBeNull();
    expect(key).toHaveAttribute("aria-invalid", "true");
    expect(calls.some((c) => c.method === "POST" && c.url === "/v1/admin/models")).toBe(false);
  });

  it("Add profile shows the app's copy too", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/models": () => [embed], "GET /v1/admin/embedding-profiles": () => [] });
    renderApp("/admin/embedding-profiles");
    await user.click(await screen.findByRole("button", { name: "Add profile" }, { timeout: scaled(4000) }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Qwen 768");
    const key = within(dialog).getByRole("textbox", { name: "Key" });
    await user.clear(key);
    await user.type(key, "Bad Key");
    await user.click(within(dialog).getByRole("button", { name: "Create profile" }));
    expect(await within(dialog).findByText(copy)).toBeInTheDocument();
    expect(within(dialog).queryByText(/match the requested format/i)).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(false));
  });
});
