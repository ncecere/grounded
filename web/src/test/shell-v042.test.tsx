/*
 * The app shell after the v0.4.2 bug hunt (M5): the session page on a rate
 * limit (AD-03, VI-03), ⌘K's tab and health commands (AD-30), the sidebar at
 * 1024px (AD-32), breadcrumbs on a phone (VI-32) and Connected apps (VI-18).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ApiError } from "../api/client";
import { fitCrumbs } from "../components/layout/breadcrumbs";
import { isRateLimited, retryDelay, shouldRetry, shouldRetrySession } from "../lib/retry";
import { mockApi, renderApp, Reply, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

const limited = (retryAfter?: number) => new ApiError(429, "rate_limited", "Too many requests. Try again shortly.", undefined, retryAfter);

describe("retrying a rate limit (AD-03)", () => {
  it("waits for Retry-After (at most a minute) and never retries a team's daily limit", () => {
    expect(isRateLimited(limited(12))).toBe(true);
    expect(isRateLimited(new ApiError(429, "rate_limited", "Daily limit", { limit: "queries_per_day" }, 3600))).toBe(false);
    expect(retryDelay(0, limited(12), () => 0)).toBe(12_000);
    expect(retryDelay(3, limited(), () => 0)).toBe(8_000);
    expect(retryDelay(0, limited(60), () => 0)).toBe(60_000);
    expect(retryDelay(2, new Error("network"))).toBe(4_000);
  });

  it("retries queries twice, and the session until the limit lifts", () => {
    expect(shouldRetry(1, limited(5))).toBe(true);
    expect(shouldRetry(2, limited(5))).toBe(false);
    expect(shouldRetry(0, new ApiError(404, "not_found", "x"))).toBe(false);
    expect(shouldRetrySession(10, limited(5))).toBe(true);
  });
});

describe("the session page (VI-03)", () => {
  it("explains a rate limit, counts down and loads the app with Try again now", async () => {
    let refuse = true;
    mockApi({
      ...shellRoutes(),
      "GET /v1/me": () => (refuse ? Reply.error(429, "rate_limited", "Too many requests. Try again shortly.", undefined, { "Retry-After": "30" }) : shellRoutes()["GET /v1/me"]!(undefined, undefined as never)),
      "GET /v1/agents": () => [],
    });
    const { container } = renderApp("/");
    expect(await screen.findByRole("heading", { name: "Too many requests" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/Trying again in \d+ s\./)).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your session")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again now" }));
    expect(await screen.findByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });

  it("keeps the app when a later refresh of the session fails", async () => {
    let refuse = false;
    mockApi({
      ...shellRoutes(),
      "GET /v1/me": () => (refuse ? Reply.error(500, "internal", "Something went wrong") : shellRoutes()["GET /v1/me"]!(undefined, undefined as never)),
      "GET /v1/agents": () => [],
    });
    const { qc } = renderApp("/");
    await screen.findByRole("navigation", { name: "Breadcrumb" });
    refuse = true;
    await qc.refetchQueries({ queryKey: ["me"] });
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });
});

describe("⌘K (AD-30)", () => {
  async function palette(path: string) {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/agents": () => [], "GET /v1/search": () => [] });
    renderApp(path);
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "Breadcrumb" });
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    return { user, dialog, input: within(dialog).getByRole("combobox", { name: "Command palette" }) };
  }

  it("finds an admin page's tab from several words, first", async () => {
    const { user, dialog, input } = await palette("/");
    await user.type(input, "costs settings");
    const options = await within(dialog).findAllByRole("option");
    expect(options[0]).toHaveTextContent("Costs › Settings");
  });

  it("finds failing models and connections for health", async () => {
    const { user, dialog, input } = await palette("/");
    await user.type(input, "health");
    expect(await within(dialog).findByRole("option", { name: /Failing models/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /Failing connections/ })).toBeInTheDocument();
  });
});

describe("shell layout", () => {
  it("collapses the trail between the first and last crumbs on a phone past two crumbs (VI-32)", () => {
    const trail = [{ label: "Demo" }, { label: "Data sources" }, { label: "Go documentation" }];
    const fitted = fitCrumbs(trail, true);
    expect(fitted.map((c) => (c.collapsed ? "…" : c.label))).toEqual(["Demo", "…", "Go documentation"]);
    expect(fitCrumbs(trail.slice(0, 2), true)).toHaveLength(2);
    expect(fitCrumbs(trail, false)).toBe(trail);
  });

  it("names Connected apps in the breadcrumb, with the card saying whose they are (VI-18)", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/me/oauth-grants": () => [] });
    renderApp("/settings/connected-apps");
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    await waitFor(() => expect(within(crumbs).getByText("Connected apps")).toHaveAttribute("aria-current", "page"));
    expect(await screen.findByRole("heading", { name: "Your apps" })).toBeInTheDocument();
  });

  it("starts the sidebar as icons on a window narrower than 1100px (AD-32), until the person chooses", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("68.75rem"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    mockApi({ ...shellRoutes(), "GET /v1/agents": () => [] });
    renderApp("/");
    expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });
});
