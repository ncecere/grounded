/* #132: "Page not found" inside a team no longer keeps the "Overview" crumb; a collapsed "…" crumb takes only its button's width. */
import { readFileSync } from "node:fs";
import { screen, waitFor } from "@testing-library/react";
import { mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

describe("breadcrumbs in a team", () => {
  it("an unknown address under a team says Page not found, not Overview", async () => {
    mockApi({ ...shellRoutes() });
    renderApp("/teams/registrar/no-such-page");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" }, { timeout: scaled(4000) })).toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    await waitFor(() => expect(crumbs).toHaveTextContent(/^Office of the RegistrarPage not found$/));
    expect(crumbs).not.toHaveTextContent("Overview");
    await waitFor(() => expect(document.title).toMatch(/^Page not found · Office of the Registrar · /));
  });

  it("the team's own page is still Overview", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/teams/registrar/kbs": () => [], "GET /v1/teams/registrar/agents": () => [], "GET /v1/teams/registrar/members": () => [], "GET /v1/teams/registrar/invites": () => [] });
    renderApp("/teams/registrar");
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" }, { timeout: scaled(4000) });
    await waitFor(() => expect(crumbs).toHaveTextContent(/Office of the Registrar\s*Overview$/));
  });

  // jsdom does no layout: this reads the rule. Checked in headless Chromium at 390 px against a mock API (see the commit).
  it("the collapsed … crumb is not given the width of its hidden label", () => {
    const css = readFileSync("src/components/layout/layout.module.css", "utf8");
    const m = /(?:^|\n)nav\.crumbs li:has\(> button\):not\(:last-child\) \{([^}]*)\}/.exec(css);
    expect(m?.[1] ?? "").toMatch(/min-width:\s*0/);
  });
});
