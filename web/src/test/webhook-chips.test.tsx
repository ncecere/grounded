/* The webhook lists' event chips (QA v0.6.0, #140): no list bullets over the chips. The list is one component, Team settings and Admin both use it. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { screen } from "@testing-library/react";
import { mockApi, renderApp } from "./harness";
import { hook, teamSettingsRoutes, webhookRoutes } from "./webhooks-fixtures";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

/** The declarations of `.name { … }` in a CSS module. */
const rule = (css: string, name: string) => new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

describe("the event chips of a webhook", () => {
  it("are a list without bullets or the browser's 40 px indent (a flex list keeps both, and the bullets overlapped the chips)", async () => {
    mockApi({ ...teamSettingsRoutes("owner"), ...webhookRoutes("/v1/teams/registrar/webhooks", { hooks: [hook({ events: ["agent.published", "source.synced"] })], deliveries: [], secrets: [] }) });
    renderApp("/teams/registrar/settings?tab=webhooks");
    const chips = await screen.findByRole("list", { name: /^Events of / }, { timeout: scaled(5000) });
    expect(chips).toHaveClass(/events/);
    expect(chips.querySelectorAll("li")).toHaveLength(2);
    // jsdom doesn't apply CSS: read the rule the list's class names.
    const css = readFileSync(path.resolve(__dirname, "../pages/webhooks/webhooks.module.css"), "utf8");
    const events = rule(css, "events");
    expect(events).toMatch(/list-style:\s*none/);
    expect(events).toMatch(/padding:\s*0\s*;/);
  });
});
