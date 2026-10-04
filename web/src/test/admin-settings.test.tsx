/*
 * Admin → Settings (AD-39): the currency, time zone and default budget saved with the cost settings' other fields as
 * they are, the budget label never taking an invalid currency (AD-34), the feature switches, what the environment sets
 * (read-only, with its variable), links to the areas with their own settings, and auditors reading it all.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { generalErrors, labelCurrency } from "../pages/admin/settings/general";
import { type Handler, meFor, mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const costs: Schemas["CostSettings"] = {
  mode: "enforce", currency: "USD", timeZone: "America/New_York", warnPercent: 75, defaultBudget: null, revision: 4, updatedAt: "2026-09-20T10:00:00Z",
};

const routes = (role: "platform_admin" | "platform_auditor" = "platform_admin", extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes(role),
  "GET /v1/me": () => meFor(role),
  "GET /v1/admin/costs/settings": () => costs,
  "GET /v1/admin/settings/evaluations": () => ({ enabled: true, revision: 2, updatedAt: "2026-09-01T10:00:00Z" }),
  "GET /v1/admin/settings/mcp": () => ({ enabled: false, oauthEnabled: false, revision: 4, updatedAt: "2026-09-01T10:00:00Z" }),
  "GET /v1/admin/settings/answer-cache": () => ({ enabled: true, revision: 1, updatedAt: "2026-09-01T10:00:00Z" }),
  ...extra,
});

describe("Admin → Settings", () => {
  it("saves the currency, time zone and default budget with If-Match, keeping the cost mode and threshold", async () => {
    const calls = mockApi(routes("platform_admin", { "PUT /v1/admin/costs/settings": (b) => ({ ...costs, ...(b as object), revision: 5 }) }));
    const { container } = renderApp("/admin/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    const currency = await screen.findByRole("textbox", { name: "Currency" });
    // AD-34: typing an invalid code doesn't relabel the budget field.
    await userEvent.clear(currency);
    await userEvent.type(currency, "us");
    expect(screen.getByRole("textbox", { name: "Default monthly budget (USD)" })).toBeInTheDocument();
    await userEvent.type(currency, "d");
    await userEvent.clear(currency);
    await userEvent.type(currency, "EUR");
    expect(screen.getByRole("textbox", { name: "Default monthly budget (EUR)" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: /Default monthly budget/ }), "250");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"4"');
    expect(put.body).toEqual({ mode: "enforce", warnPercent: 75, currency: "EUR", timeZone: "America/New_York", defaultBudget: "250" });
  });

  it("has the feature switches, what the environment sets and links to the other settings pages", async () => {
    mockApi(routes());
    renderApp("/admin/settings");
    const features = (await screen.findByRole("heading", { level: 2, name: "Features" })).closest("section")!;
    expect(features).toHaveAttribute("id", "features");
    expect(await within(features).findByRole("switch", { name: "Allow evaluations" })).toBeChecked();
    expect(within(features).getByRole("switch", { name: "Allow MCP clients" })).not.toBeChecked();
    const env = screen.getByRole("table", { name: "Settings from the environment" });
    expect(within(env).getByRole("row", { name: /Instance name Grounded INSTANCE_NAME/ })).toBeInTheDocument();
    expect(within(env).getByRole("row", { name: /Help link Not set SUPPORT_URL/ })).toBeInTheDocument();
    expect(within(env).queryByRole("textbox")).toBeNull();
    const others = screen.getByRole("list", { name: "Other settings" });
    expect(within(others).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Costs", "Moderation", "Public access", "Limits", "Retention", "Reranking", "SystemOne", "Parsing & OCR",
    ]);
    expect(within(others).getByRole("link", { name: "Reranking" })).toHaveAttribute("href", "/admin/reranking");
  });

  it("is read-only for auditors, with the reason", async () => {
    mockApi(routes("platform_auditor"));
    const { container } = renderApp("/admin/settings");
    expect(await screen.findByText(/Only platform admins can change/)).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Currency" })).toBeDisabled();
    const toggle = await screen.findByRole("switch", { name: "Allow evaluations" });
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("checks the fields and labels the budget with a valid currency only (AD-34)", () => {
    expect(generalErrors({ currency: "US", timeZone: "", defaultBudget: "abc", mode: "off", warnPercent: 80 })).toEqual({
      currency: "Enter a three-letter ISO 4217 code, such as USD or EUR.",
      timeZone: "Choose a time zone.",
      defaultBudget: expect.stringMatching(/default budget/),
    });
    expect(labelCurrency("US", "USD")).toBe("USD");
    expect(labelCurrency("EUR", "USD")).toBe("EUR");
  });
});
