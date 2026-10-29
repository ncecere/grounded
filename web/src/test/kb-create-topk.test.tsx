/* #132: a top-k that is not a whole number in the new knowledge base dialog said the browser's "Please enter a valid value". */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderApp, shellRoutes } from "./harness";

describe("New knowledge base dialog", () => {
  it("says what the results-per-query number must be, in the form's own words", async () => {
    const calls = mockApi({ ...shellRoutes("none", "owner"), "GET /v1/teams/registrar/kbs": () => [], "GET /v1/teams/registrar/sources": () => [] });
    renderApp("/teams/registrar/kbs");
    await userEvent.click((await screen.findAllByRole("button", { name: /knowledge base/i }))[0]!);
    const topK = await screen.findByLabelText(/Results per query/);
    await userEvent.type(await screen.findByLabelText("Name"), "Handbook");
    for (const bad of ["8.5", "0", "51", ""]) {
      await userEvent.clear(topK);
      if (bad) await userEvent.type(topK, bad);
      await userEvent.click(screen.getByRole("button", { name: "Create knowledge base" }));
      expect(await screen.findByText("Enter a whole number from 1 to 50.")).toBeInTheDocument();
      expect(screen.queryByText(/Please enter a valid value/i)).not.toBeInTheDocument();
    }
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});
