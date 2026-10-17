/* #132: an upload refused with 429 says so, with the Retry-After seconds, instead of "Check your connection". */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamContext, teamCtx, type Team } from "../pages/team/common";
import { UploadArea } from "../pages/team/documents/upload";
import { meFor } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const team: Team = {
  id: "t1", slug: "registrar", name: "Office of the Registrar", description: "", maxClassification: "restricted", status: "active", revision: 1, createdAt: "", updatedAt: "",
};

/** How the next upload ends: which callback fires, with which status, body and headers. */
type Outcome = { fires: "onload" | "onerror"; status: number; body?: unknown; headers?: Record<string, string> };

function stubXHR(outcome: Outcome) {
  class FakeXHR {
    upload = { onprogress: null as unknown };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    status = 0;
    responseText = "";
    open() {}
    setRequestHeader() {}
    getResponseHeader(name: string) {
      return outcome.headers?.[name] ?? null;
    }
    send() {
      setTimeout(() => {
        this.status = outcome.status;
        this.responseText = outcome.body === undefined ? "" : JSON.stringify(outcome.body);
        this[outcome.fires]?.();
      }, 0);
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
}

async function uploadOne() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], meFor());
  const root = createRootRoute({
    component: () => (
      <TeamContext.Provider value={teamCtx(team, "editor")}>
        <UploadArea sourceId="s1" />
      </TeamContext.Provider>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Choose files to upload" });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await userEvent.upload(input, [new File(["%PDF-1.7"], "handbook.pdf", { type: "application/pdf" })], { applyAccept: false });
}

describe("an upload the server refuses with 429", () => {
  it("shows the rate limit and its Retry-After when the response arrives", async () => {
    stubXHR({ fires: "onload", status: 429, body: { error: { code: "rate_limited", message: "Too many requests. Try again shortly." } }, headers: { "Retry-After": "7" } });
    await uploadOne();
    expect(await screen.findByText("Too many requests")).toBeInTheDocument();
    expect(screen.getByText(/Too many requests\. Try again shortly\. You can try again in 7 s\./)).toBeInTheDocument();
    expect(screen.queryByText(/Check your connection/)).toBeNull();
  });

  it("shows the rate limit, not a connection problem, when the browser reports an error but the status is 429", async () => {
    stubXHR({ fires: "onerror", status: 429, headers: { "Retry-After": "12" } });
    await uploadOne();
    expect(await screen.findByText("Too many requests")).toBeInTheDocument();
    expect(screen.getByText(/You can try again in 12 s\./)).toBeInTheDocument();
    expect(screen.queryByText(/Check your connection/)).toBeNull();
  });

  it("still blames the connection when there is no response at all", async () => {
    stubXHR({ fires: "onerror", status: 0 });
    await uploadOne();
    expect(await screen.findByText(/The upload failed\. Check your connection and try again\./)).toBeInTheDocument();
  });
});
