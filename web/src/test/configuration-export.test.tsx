import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { mockApi, renderApp, shellRoutes, team } from "./harness";

it.each(["owner", "admin", "editor"])("offers export for actual %s, with no automatic request", async (role) => {
  const calls = mockApi(shellRoutes("none", role));
  const { container } = renderApp("/teams/registrar/settings?tab=general");
  const button = await screen.findByRole("button", { name: "Export configuration" });
  expect(calls.some((c) => c.url.endsWith("/configuration"))).toBe(false);
  expect(await axe(container)).toHaveNoViolations();
  button.focus();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByText(/Configuration could not be exported/)).toBeInTheDocument();
  expect(calls.some((c) => c.url.endsWith("/configuration"))).toBe(true);
});

it("does not offer export or request it for a member", async () => {
  const calls = mockApi(shellRoutes("none", "member"));
  renderApp("/teams/registrar/settings?tab=general");
  await screen.findByRole("heading", { name: "General" });
  expect(screen.queryByRole("button", { name: "Export configuration" })).toBeNull();
  expect(calls.some((c) => c.url.endsWith("/configuration"))).toBe(false);
});

it("downloads the server's checked YAML using a fixed safe filename", async () => {
  const yaml = '{"apiVersion":"grounded.team/v1"}';
  mockApi({
    ...shellRoutes("none", "owner"),
    "GET /v1/teams/registrar/configuration": () => new Response(yaml, { headers: { "Content-Type": "application/yaml" } }),
  });
  const create = vi.fn(() => "blob:checked-yaml");
  const revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = create;
    static revokeObjectURL = revoke;
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe("team-configuration.yaml");
    expect(this.href).toBe("blob:checked-yaml");
  });
  renderApp("/teams/registrar/settings?tab=general");
  await userEvent.click(await screen.findByRole("button", { name: "Export configuration" }));
  expect(await screen.findByText("Configuration checked. Download started.")).toBeInTheDocument();
  expect(create).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:checked-yaml"));
  click.mockRestore();
});

it("does not offer a platform-only caller export or send a request", async () => {
  const calls = mockApi({
    ...shellRoutes("platform_admin", "owner"),
    "GET /v1/teams/registrar": () => ({ team }),
  });
  renderApp("/teams/registrar/settings?tab=general");
  await screen.findByRole("heading", { name: "General" });
  expect(screen.queryByRole("button", { name: "Export configuration" })).toBeNull();
  expect(calls.some((c) => c.url.endsWith("/configuration"))).toBe(false);
});
