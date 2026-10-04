/* The documents table's selection follows the filters (BU-04), and a filtered list refreshes when a retried document fails again (BU-11). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Schemas } from "../api/client";
import { SourceDetail } from "../pages/sources/detail";
import { common, counts, mockApi, renderWith, webSource } from "./web-harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const doc = (id: string, title: string, extra: Partial<Schemas["Document"]> = {}): Schemas["Document"] => ({
  id,
  sourceId: "s1",
  title,
  filename: `${id}.pdf`,
  url: "",
  kind: "pdf",
  sizeBytes: 1000,
  version: 1,
  status: "ready",
  errorCode: "",
  errorMessage: "",
  errorDetail: "",
  pages: 1,
  chunkCount: 2,
  tokenCount: 200,
  warnings: [],
  tags: [],
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
  ...extra,
});

const upload = (c = counts) => webSource({ type: "upload", web: null, name: "Policies", lastSyncAt: null, nextSyncAt: null, documents: c });

describe("documents selection (BU-04)", () => {
  it("clears a selection the filter hides, and deletes exactly the rows it names", async () => {
    const ready = doc("d1", "Handbook");
    const failed = doc("d2", "Broken scan", { status: "failed", errorCode: "corrupt", errorMessage: "This PDF appears to be damaged." });
    const calls = mockApi({
      ...common,
      "GET /v1/teams/registrar/sources/s1": () => upload(),
      "GET /v1/teams/registrar/sources/s1/tags": () => [],
      "GET /v1/teams/registrar/kbs": () => [],
      "GET /v1/teams/registrar/sources/s1/documents": (_b, url) => ({
        items: url.searchParams.get("status") === "failed" ? [failed] : [ready, failed],
        nextCursor: null,
      }),
      "DELETE /v1/teams/registrar/sources/s1/documents/d2": () => null,
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Documents/ }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Handbook" }));
    expect(screen.getByText("1 document selected")).toBeInTheDocument();
    // Ready documents can't be retried, and the button says why.
    expect(screen.getByRole("button", { name: "Retry" })).toHaveAttribute("title", "Only failed, skipped or partly scanned documents can be retried.");

    // The Failed filter hides Handbook: nothing stays selected out of sight.
    await userEvent.click(screen.getByRole("button", { name: "Failed" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Select Handbook" })).toBeNull());
    expect(screen.queryByText(/document selected/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    await userEvent.click(screen.getByRole("checkbox", { name: "Select Broken scan" }));
    expect(screen.getByText("1 document selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete Broken scan?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete document" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/v1/teams/registrar/sources/s1/documents/d2"]));
  });
});

describe("a retried document that fails again (BU-11)", () => {
  it("comes back in the Failed view without switching filters", async () => {
    const broken = doc("d2", "Broken scan", { status: "failed", errorCode: "corrupt", errorMessage: "This PDF appears to be damaged." });
    let state: "failed" | "pending" | "failed-again" = "failed";
    const sourceCounts = () => ({ ...counts, pending: state === "pending" ? 1 : 0, failed: state === "pending" ? 0 : 1 });
    mockApi({
      ...common,
      "GET /v1/teams/registrar/sources/s1": () => upload(sourceCounts()),
      "GET /v1/teams/registrar/sources/s1/tags": () => [],
      "GET /v1/teams/registrar/kbs": () => [],
      "GET /v1/teams/registrar/sources/s1/documents": () => ({ items: state === "pending" ? [] : [broken], nextCursor: null }),
      "POST /v1/teams/registrar/sources/s1/documents/d2/retry": () => {
        state = "pending";
        return { ...broken, status: "pending" };
      },
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Documents/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Failed" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Broken scan" }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/match these filters/)).toBeInTheDocument();
    // The worker fails it again; the source's counts change on its next poll.
    state = "failed-again";
    expect(await screen.findByRole("checkbox", { name: "Select Broken scan" }, { timeout: 8000 })).not.toBeChecked();
  }, 12_000);
});
