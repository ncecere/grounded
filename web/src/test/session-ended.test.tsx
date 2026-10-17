/* The session ends while the app is open (QA v0.6.0, #121): the sign-in page, not "Something went wrong!". */
import { fireEvent, screen } from "@testing-library/react";
import { mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("session ended while a page is open", () => {
  it("shows the sign-in page, returning to the page, even when a mounted component renders first", async () => {
    mockApi({
      ...shellRoutes(),
      "GET /v1/auth/config": () => ({ oidcEnabled: true, devAuthEnabled: false, loginUrl: "/auth/login", teamRequestUrl: null, devAccounts: [] }),
    });
    window.history.replaceState(null, "", "/settings/profile");
    const { qc } = renderApp("/settings/profile");
    expect(await screen.findByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    // The cached session turns to signed out and, in the same tick, the shell (which reads the user)
    // re-renders on its own, before SessionGate has swapped the tree: a chat's 401 does exactly this.
    qc.setQueryData(["me"], null);
    fireEvent.click(collapse);
    expect(await screen.findByRole("heading", { level: 2, name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong!")).toBeNull();
    expect(screen.getByRole("link", { name: /single sign-on/ })).toHaveAttribute("href", "/auth/login?next=%2Fsettings%2Fprofile");
  });
});
