/* A signed-out visitor on a team address (/a/{team}/{agent}) of an agent that isn't served publicly (QA v0.6.0, #120). */
import { screen, waitFor } from "@testing-library/react";
import { Reply, mockApi, renderApp } from "./harness";

afterEach(() => vi.unstubAllGlobals());

const signedOut = {
  "GET /v1/me": () => Reply.error(401, "unauthorized"),
  "GET /v1/auth/config": () => ({ oidcEnabled: false, devAuthEnabled: true, loginUrl: "/auth/login", teamRequestUrl: null, devAccounts: [], instance: { name: "Campus RAG", orgName: "", theme: "neutral", logoUrl: null, supportUrl: null } }),
};
const publicCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.startsWith("/v1/public/teams/")).length;

describe("team address while the agent isn't served publicly", () => {
  it("shows the sign-in page, with one request, when public chat is off (503 public_disabled)", async () => {
    const calls = mockApi({ ...signedOut, "GET /v1/public/teams/demo/agents/go-docs": () => Reply.error(503, "public_disabled", "Public chat is turned off") });
    renderApp("/a/demo/go-docs");
    expect(await screen.findByRole("heading", { level: 2, name: "Sign in" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 200));
    // The page used to loop on "Loading…", one request after another, without end.
    expect(publicCalls(calls)).toBeLessThanOrEqual(2);
  });

  it("settles on the 'isn't available' page, without looping, for another error (500)", async () => {
    const calls = mockApi({ ...signedOut, "GET /v1/public/teams/demo/agents/go-docs": () => Reply.error(500, "internal", "Something broke") });
    renderApp("/a/demo/go-docs");
    expect(await screen.findByRole("heading", { level: 1, name: "This assistant isn't available publicly" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 200));
    await waitFor(() => expect(publicCalls(calls)).toBeLessThanOrEqual(2));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
