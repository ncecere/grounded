/* Saving a web source's settings the server refuses (QA v0.6.0, #130): the refusal is shown where the person is looking. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SourceDetail } from "../pages/sources/detail";
import { ApiFailure, mockApi, renderWith, webRoutes, webSource } from "./web-harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

async function openSettings(patch: () => unknown) {
  const calls = mockApi({ ...webRoutes(webSource()), "PATCH /v1/teams/registrar/sources/s1": patch });
  renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
  await userEvent.click(await screen.findByRole("tab", { name: "Settings" }));
  const settings = await screen.findByRole("region", { name: "Crawling" });
  return { calls, settings };
}

describe("a refused save of the crawl settings", () => {
  it("shows the server's message under Maximum pages, opens Advanced and puts focus on the field", async () => {
    const { calls, settings } = await openSettings(() => new ApiFailure(400, "invalid_web_config", "maxPages must be between 1 and 10000"));
    await userEvent.click(within(settings).getByRole("button", { name: /Advanced crawl options/ }));
    const pages = within(settings).getByLabelText(/Maximum pages/);
    await userEvent.clear(pages);
    await userEvent.type(pages, "99999");
    await userEvent.click(within(settings).getByRole("button", { name: /Advanced crawl options/ })); // closed again
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    // Under the field, not at the end of the form, and the field has focus (the alert sat 900 px below the Save bar).
    expect(await within(settings).findByText("maxPages must be between 1 and 10000.")).toBeInTheDocument();
    const field = within(settings).getByLabelText(/Maximum pages/);
    expect(field).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.queryByRole("alert")).toBeNull(); // not said twice, a screen further down
    // Editing the value takes the refusal back, and Save is possible again.
    await userEvent.clear(field);
    await userEvent.type(field, "5000");
    await waitFor(() => expect(within(settings).queryByText("maxPages must be between 1 and 10000.")).toBeNull());
    expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();
  });

  it("brings another refusal, which has no field, into view and focuses it", async () => {
    const { settings } = await openSettings(() => new ApiFailure(400, "invalid_web_config", "crawl mode takes 1-20 seed URLs"));
    await userEvent.selectOptions(within(settings).getByRole("combobox", { name: "Sync schedule" }), "daily");
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("crawl mode takes 1-20 seed URLs");
    await waitFor(() => expect(scrolled.mock.contexts.some((el) => el instanceof Element && (el === alert || el.contains(alert) || alert.contains(el)))).toBe(true));
    await waitFor(() => expect(alert.contains(document.activeElement) || alert.parentElement?.contains(document.activeElement)).toBe(true));
  });
});
