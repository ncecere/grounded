/*
 * Admin forms from the v0.4.2 re-test: Add model opened by its address (AD2-03), Add connection after a server error
 * (AD2-04) and its limits (AD2-21), the Reranking guide's way through Add connection (AD2-06), the model key following
 * the display name (AD2-24) and Add level without a no-op PATCH (AD2-14).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { chosenConnection } from "../pages/admin/models/model-dialog";
import { connectionProblems } from "../pages/admin/models/connection-record";
import { mockApi, renderApp, Reply, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const conn = { id: "c1", name: "Gateway", baseUrl: "http://gateway.example.edu/v1", enabled: true, modelCount: 0, revision: 1, timeoutSeconds: 60, maxConcurrentRequests: 8 };
const later = <T,>(value: T, ms = 150) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("Add model opened by its address (AD2-03)", () => {
  it("sends the connection the select shows, though the connections loaded after the form", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => later([conn]),
      "GET /v1/admin/models": () => [],
      "POST /v1/admin/connections/c1/test": () => ({ ok: true, latencyMs: 5, probe: "models", models: ["bge-reranker-v2-m3"] }),
      "POST /v1/admin/models": (b) => ({ id: "m1", ...(b as object) }),
    });
    renderApp("/admin/models?form=new&kind=rerank");
    const select = await screen.findByRole("combobox", { name: "Connection" }, { timeout: 4000 });
    await waitFor(() => expect(select).toHaveValue("c1"));
    await user.type(screen.getByRole("combobox", { name: "Upstream model ID" }), "bge-reranker-v2-m3");
    await user.type(screen.getByRole("textbox", { name: "Display name" }), "Campus reranker");
    // AD2-24: the key follows the display name until it's typed.
    expect(screen.getByRole("textbox", { name: "Key" })).toHaveValue("campus-reranker");
    await user.click(screen.getByRole("button", { name: "Add model" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url === "/v1/admin/models")?.body).toMatchObject({ connectionId: "c1", key: "campus-reranker", kind: "rerank" }));
  });

  it("chooses the connection asked for, else the first, and keeps a chosen one", () => {
    const list = [{ id: "a" }, { id: "b" }];
    expect(chosenConnection("", list)).toBe("a");
    expect(chosenConnection("", list, "b")).toBe("b");
    expect(chosenConnection("a", list, "b")).toBe("a");
    expect(chosenConnection("", [])).toBe("");
  });
});

describe("Add connection after a server error (AD2-04, AD2-21)", () => {
  it("drops the stale field error once the field changes, and Add sends again", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => [],
      "GET /v1/admin/models": () => [],
      "POST /v1/admin/connections": (b) =>
        (b as { baseUrl: string }).baseUrl.startsWith("ftp:") ? Reply.error(400, "invalid_base_url", "Base URL must be an http(s) URL") : { ...conn, ...(b as object), id: "c9" },
    });
    const { container } = renderApp("/admin/connections?form=new");
    await user.type(await screen.findByRole("textbox", { name: "Name" }, { timeout: 4000 }), "Beta bad");
    const url = screen.getByRole("textbox", { name: /Base URL/ });
    await user.type(url, "ftp://example.org");
    await user.click(screen.getByRole("button", { name: "Add connection" }));
    expect(await screen.findByText("Base URL must be an http(s) URL.")).toBeInTheDocument();
    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(await axe(container)).toHaveNoViolations();

    await user.clear(url);
    await user.type(url, "http://127.0.0.1:9/v1");
    expect(screen.queryByText("Base URL must be an http(s) URL.")).toBeNull();
    expect(url).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Add connection" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.url === "/v1/admin/connections")).toHaveLength(2));
  });

  it("checks the limits before sending", () => {
    expect(connectionProblems({ timeoutSeconds: "0", maxConcurrentRequests: "8", requestsPerMinute: "" })).toEqual({ timeoutSeconds: "Enter a whole number of seconds from 1 to 600." });
    expect(connectionProblems({ timeoutSeconds: "60", maxConcurrentRequests: "300", requestsPerMinute: "1.5" })).toMatchObject({
      maxConcurrentRequests: expect.stringMatching(/1 to 256/),
      requestsPerMinute: expect.stringMatching(/empty for unlimited/),
    });
    expect(connectionProblems({ timeoutSeconds: "60", maxConcurrentRequests: "8", requestsPerMinute: "" })).toEqual({});
  });
});

describe("the Reranking guide's Add connection (AD2-06)", () => {
  it("comes back to Reranking, offers to test the new connection and starts Add model on it", async () => {
    const user = userEvent.setup();
    let list: (typeof conn)[] = [];
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => list,
      "GET /v1/admin/models": () => [],
      "GET /v1/admin/health-checks": () => [],
      "GET /v1/admin/rerank": () => ({ modelId: null, candidates: 40, timeLimitMs: 2000, agents: 0, agentsOff: [], revision: 1, updatedAt: null }),
      "POST /v1/admin/connections": (b) => (list = [{ ...conn, ...(b as object), id: "c9" }])[0],
      "POST /v1/admin/connections/c9/test": () => ({ ok: true, latencyMs: 12, probe: "models", models: ["bge-reranker-v2-m3"] }),
    });
    const { router } = renderApp("/admin/connections?form=new&from=reranking");
    await user.type(await screen.findByRole("textbox", { name: "Name" }, { timeout: 4000 }), "Rerank server");
    await user.type(screen.getByRole("textbox", { name: /Base URL/ }), "http://rerank.example.edu/v1");
    await user.click(screen.getByRole("button", { name: "Add connection" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/reranking"));
    const guide = (await screen.findByRole("heading", { name: "Set up reranking" }, { timeout: 4000 })).closest("section")!;
    expect(await within(guide).findByText(/Rerank server was added\./)).toBeInTheDocument();
    await user.click(within(guide).getByRole("button", { name: "Test Rerank server" }));
    expect(await within(guide).findByText("Connected in 12 ms. It offers 1 model: bge-reranker-v2-m3.")).toBeInTheDocument();
    expect(within(guide).getByRole("link", { name: "Add model" })).toHaveAttribute("href", expect.stringContaining("connection=c9"));
  });
});

describe("Add level (AD2-14)", () => {
  it("creates the level without a PATCH that changes nothing", async () => {
    const user = userEvent.setup();
    const created: Schemas["Classification"] = {
      key: "beta", name: "Beta", description: "", rank: 10, maxAudience: "team", anonymousRetentionHours: 24, conversationRetentionDays: null,
      allowedSourceTypes: ["upload", "web"], directRetrieve: true, revision: 1, createdAt: "", updatedAt: "",
    };
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/classifications": () => [],
      "GET /v1/admin/models": () => [],
      "GET /v1/admin/teams": () => ({ items: [] }),
      "POST /v1/admin/classifications": () => created,
    });
    renderApp("/admin/classifications?form=new");
    await user.type(await screen.findByRole("textbox", { name: /^Key/ }, { timeout: 4000 }), "beta");
    await user.type(screen.getByRole("textbox", { name: /^Name/ }), "Beta");
    const submit = screen.getAllByRole("button", { name: /^Add level/ }).find((b) => b.getAttribute("type") === "submit")!;
    await user.click(submit);
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(await screen.findByText("Beta was added")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});
