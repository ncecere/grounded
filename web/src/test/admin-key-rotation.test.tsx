/* Admin → Overview: the API key pepper rotation notice (E10). */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { type Handler, mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const key = (over: Partial<Schemas["PepperKey"]>): Schemas["PepperKey"] => ({
  kind: "api_key",
  id: "k1",
  name: "Loader",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  agentName: null,
  lastUsedAt: null,
  createdAt: "2026-09-01T10:00:00Z",
  state: "previous",
  ...over,
});

const routes = (status: Schemas["KeyRotationStatus"]): Record<string, Handler> => ({
  ...shellRoutes("platform_admin"),
  "GET /v1/admin/key-rotation": () => status,
});

describe("key rotation notice", () => {
  it("counts keys still on the previous pepper and lists them", async () => {
    mockApi(
      routes({
        previousPepperConfigured: true,
        keys: [
          key({}),
          key({ id: "k2", kind: "publishable_key", name: "Main site", agentName: "Open help", lastUsedAt: "2026-09-20T10:00:00Z" }),
          key({ id: "k3", name: "Old", state: "retired" }),
        ],
      }),
    );
    const { container } = renderApp("/admin");
    const notice = await screen.findByText("2 keys still on the previous API key pepper");
    expect(within(notice.closest("[role=status]")!).getByText(/1 key can no longer work/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Show keys" }));
    const dialog = await screen.findByRole("dialog", { name: "Keys not on the current pepper" });
    expect(within(dialog).getByText("Main site (Open help)")).toBeInTheDocument();
    expect(within(dialog).getByText("Widget key")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Re-hashed on next use")).toHaveLength(2);
    expect(within(dialog).getByText("No longer works")).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it("says nothing when every key is on the current pepper", async () => {
    mockApi(routes({ previousPepperConfigured: true, keys: [] }));
    renderApp("/admin");
    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(screen.queryByText(/API key pepper/)).not.toBeInTheDocument();
  });
});
