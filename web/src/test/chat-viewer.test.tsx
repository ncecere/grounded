/* The source viewer (docs/v0.4.0.md §5): the cited passage in context, its claims, the whole document for editors, deleted and changed passages, Try it, public sessions, phones, axe. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { type AssistantItem, type ChatItem, applyChatEvent, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import type { ViewerAccess } from "../pages/chat/viewer/data";
import { ViewerHost } from "../pages/chat/viewer/host";
import { fragmentWords, textFragmentUrl } from "../pages/chat/viewer/text-fragment";
import { Reply, mockApi, renderBare } from "./harness";

type Claim = Schemas["Claim"];

const cite = (n: number, extra: Partial<Schemas["Citation"]> = {}): Schemas["Citation"] => ({
  n, documentId: `d${n}`, sourceId: "s1", title: `Fees ${n}`, snippet: `Passage ${n} about fees.`, headingPath: ["Fees"], chunkId: `c${n}`, ...extra,
});
const text = "Transcripts cost $10 [1]. Rush orders arrive the same day [1][2].";
const claims: Claim[] = [
  { index: 0, start: 0, end: 25, text: "Transcripts cost $10.", verdict: "supported", sources: [1], checks: [{ n: 1, occurrence: 0, verification: "verified" }] },
  {
    index: 1, start: 26, end: 65, text: "Rush orders arrive the same day.", verdict: "not_supported", sources: [],
    checks: [{ n: 1, occurrence: 1, verification: "unsupported" }, { n: 2, occurrence: 0, verification: "contradicted" }],
  },
];

function answer(citations = [cite(1), cite(2, { url: "https://registrar.example.edu/rush/" })]): AssistantItem {
  let a = applyChatEvent(pendingAssistant(), "message_start", { messageId: "m1" });
  a = applyChatEvent(a, "message_end", { messageId: "m1", stopReason: "stop", text, citations, refused: false, noContext: false });
  a = applyChatEvent(a, "citations_checked", { messageId: "m1", text, citations, claims, refused: false, verified: 1, unsupported: 2, unchecked: 0 });
  return applyChatEvent(a, "done", {});
}
const thread = (a = answer()): ChatItem[] => [{ role: "user", key: "u1", text: "What does a transcript cost?" }, a];

const passage = (ordinal: number, content: string, cited = false) => ({ ordinal, content, headingPath: ["Fees"], pageStart: 0, pageEnd: 0, cited });
const cited = (n: number, extra: Partial<Schemas["CitedPassage"]> = {}): Schemas["CitedPassage"] => ({
  n, status: "available", documentId: `d${n}`, sourceId: "s1", title: `Fees ${n}`, headingPath: ["Fees", "Transcripts"],
  passages: [passage(4, "Official transcripts are ordered online."), passage(5, `Passage ${n} about fees.`, true), passage(6, "Pick-up is at the front desk.")],
  claims: [], ...extra,
});

function renderChat(access: ViewerAccess, items = thread()) {
  return renderBare(
    <main>
      <ViewerHost access={access} items={items}>
        <ChatMessages items={items} agent={{ name: "Helper" }} />
      </ViewerHost>
    </main>,
  );
}

/** Opens the sources under the answer and source n's card in the viewer. */
async function openSource(n: number, title = `Fees ${n}`) {
  await userEvent.click(await screen.findByRole("button", { name: "Used 2 sources" }));
  await userEvent.click(screen.getByRole("button", { name: `Show source ${n}: ${title}` }));
  return screen.findByRole("region", { name: title });
}

const scrollIntoView = Element.prototype.scrollIntoView;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = scrollIntoView;
});

describe("text fragments", () => {
  it("highlight a passage on the live page by its first and last words", () => {
    expect(textFragmentUrl("https://example.edu/fees#top", "## Fees\n\n- Transcripts cost **$10** each, paid online - or by check at the front desk.")).toBe(
      "https://example.edu/fees#:~:text=Fees%20Transcripts%20cost%20%2410,at%20the%20front%20desk.",
    );
    // Short passages are matched whole; the syntax's own characters are encoded.
    expect(textFragmentUrl("https://example.edu/a", "Drop-add ends Friday, at noon & later.")).toBe("https://example.edu/a#:~:text=Drop%2Dadd%20ends%20Friday%2C%20at%20noon%20later.");
    expect(textFragmentUrl("https://example.edu/a", "---")).toBe("https://example.edu/a");
    expect(fragmentWords("| Fee | Amount |\n|---|---|\n| Rush | $5 |")).toEqual(["Fee", "Amount", "Rush", "$5"]);
  });
});

describe("source viewer", () => {
  it("shows the cited passage among its neighbours, the claims citing it, and the answer's other sources", async () => {
    mockApi({ "GET /v1/messages/m1/sources/1": () => cited(1), "GET /v1/messages/m1/sources/2": () => cited(2) });
    const { container } = renderChat({ kind: "message" });
    // Source cards break down the claims citing them in the verdict colours.
    await userEvent.click(await screen.findByRole("button", { name: "Used 2 sources" }));
    const list = screen.getByRole("list", { name: "Sources for this answer" });
    expect(within(list).getAllByTestId("source-breakdown").map((b) => b.textContent)).toEqual(["Supports 1 claim · 1 not supported", "1 claim contradicted"]);
    await userEvent.click(within(list).getByRole("button", { name: "Show source 1: Fees 1" }));
    const viewer = await screen.findByRole("region", { name: "Fees 1" });
    expect(within(viewer).getByText("Fees › Transcripts")).toBeInTheDocument();
    expect(await within(viewer).findByTestId("cited-passage")).toHaveTextContent("Passage 1 about fees.");
    expect(within(viewer).getByText("Official transcripts are ordered online.")).toBeInTheDocument();
    const claimList = within(viewer).getByRole("region", { name: "2 claims citing this source" });
    expect(within(claimList).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["SupportedTranscripts cost $10.", "Not supportedRush orders arrive the same day."]);
    // An uploaded file: no page to open, and members can't open the whole document.
    expect(within(viewer).queryByRole("link", { name: /Open the page/ })).toBeNull();
    expect(within(viewer).queryByRole("button", { name: /Open full document/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();

    // The other sources are one click away.
    const nav = within(viewer).getByRole("navigation", { name: "Sources of this answer" });
    expect(within(nav).getByRole("button", { name: "Source 1: Fees 1" })).toHaveAttribute("aria-current", "true");
    await userEvent.click(within(nav).getByRole("button", { name: "Source 2: Fees 2" }));
    const second = await screen.findByRole("region", { name: "Fees 2" });
    expect(await within(second).findByTestId("cited-passage")).toHaveTextContent("Passage 2 about fees.");
    expect(within(second).getByRole("region", { name: "The claim citing this source" })).toHaveTextContent("ContradictedRush orders");
    expect(within(second).getByRole("link", { name: /Open the page/ })).toHaveAttribute("href", "https://registrar.example.edu/rush/#:~:text=Passage%202%20about%20fees.");
    await waitFor(() => expect(within(second).getByRole("heading", { level: 2 })).toHaveFocus());

    // Close: focus goes back to the card that opened it.
    await userEvent.click(within(second).getByRole("button", { name: "Close the source" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Show source 1: Fees 1" })).toHaveFocus());
  });

  it("lets editors open the whole document, a page at a time around the cited passage", async () => {
    const page = (from: number, n: number) => ({
      documentId: "d1", sourceId: "s1", title: "Fees 1", kind: "markdown", total: 30, from,
      items: Array.from({ length: n }, (_, i) => passage(from + i, from + i === 5 ? "Passage 1 about fees." : `Paragraph ${from + i}.`)),
    });
    const calls = mockApi({
      "GET /v1/messages/m1/sources/1": () => cited(1, { documentTeam: "registrar" }),
      "GET /v1/teams/registrar/sources/s1/documents/d1/text": (_b, call) => {
        const from = Number(call.search.get("from"));
        return from === 0 ? page(0, 8) : page(from, 3);
      },
    });
    const { container } = renderChat({ kind: "message" });
    const viewer = await openSource(1);
    const full = await within(viewer).findByRole("button", { name: "Open full document" });
    await userEvent.click(full);
    expect(full).toHaveTextContent("Show the passage only");
    expect(await within(viewer).findByText("Paragraph 6.")).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith("/text"))!.search.get("from")).toBe("0");
    expect(within(viewer).getByTestId("cited-passage")).toHaveTextContent("Passage 1 about fees.");
    await userEvent.click(within(viewer).getByRole("button", { name: "Show later passages" }));
    expect(await within(viewer).findByText("Paragraph 9.")).toBeInTheDocument();
    expect(within(viewer).queryByRole("button", { name: "Show earlier passages" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(viewer).getByRole("button", { name: "Show the passage only" }));
    expect(within(viewer).queryByText("Paragraph 9.")).toBeNull();
  });

  it("says clearly when the document was deleted or the passage changed, with what the answer quoted", async () => {
    mockApi({
      "GET /v1/messages/m1/sources/1": () => cited(1, { status: "document_deleted", passages: [], documentTeam: "registrar" }),
      "GET /v1/messages/m1/sources/2": () => cited(2, { status: "passage_changed", passages: [] }),
    });
    const { container } = renderChat({ kind: "message" });
    const viewer = await openSource(1);
    expect(await within(viewer).findByText("This document was deleted after the answer was written.")).toBeInTheDocument();
    expect(within(viewer).getByText("Passage 1 about fees.")).toBeInTheDocument();
    expect(within(viewer).queryByRole("button", { name: /Open full document/ })).toBeNull();
    await userEvent.click(within(viewer).getByRole("button", { name: "Source 2: Fees 2" }));
    const second = await screen.findByRole("region", { name: "Fees 2" });
    expect(await within(second).findByText(/This passage is no longer in the document/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens Try it's passages through the team's documents, around the cited passage", async () => {
    const calls = mockApi({
      "GET /v1/teams/registrar/sources/s1/documents/d1/text": () => ({
        documentId: "d1", sourceId: "s1", title: "Fees 1", kind: "markdown", total: 9, from: 4, items: cited(1).passages,
      }),
      "GET /v1/teams/registrar/sources/s1/documents/d2/text": () => new Reply(404, { error: { code: "passage_not_found", message: "Gone" } }),
    });
    renderChat({ kind: "team", team: "registrar" }, thread({ ...answer(), id: undefined }));
    const viewer = await openSource(1);
    expect(await within(viewer).findByTestId("cited-passage")).toHaveTextContent("Passage 1 about fees.");
    expect(calls.find((c) => c.url.endsWith("/d1/text"))!.search.get("around")).toBe("c1");
    // Editors testing their draft may open the whole document.
    expect(within(viewer).getByRole("button", { name: "Open full document" })).toBeInTheDocument();
    await userEvent.click(within(viewer).getByRole("button", { name: "Source 2: Fees 2" }));
    expect(await within(await screen.findByRole("region", { name: "Fees 2" })).findByText(/This passage is no longer in the document/)).toBeInTheDocument();
  });

  it("opens a public answer's passages through the visitor's session", async () => {
    const calls = mockApi({ "GET /v1/public/agents/ag1/messages/m1/sources/1": () => cited(1) });
    renderChat({ kind: "public", agentId: "ag1" });
    const viewer = await openSource(1);
    expect(await within(viewer).findByTestId("cited-passage")).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/v1/public/agents/ag1/messages/m1/sources/1")).toBe(true);
  });

  it("opens as a full-screen sheet on phones: focus on its title, the cited passage in view, the same close, keyboard scrolling", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 40rem"), addEventListener: () => {}, removeEventListener: () => {} }));
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(994);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(777);
    // One source: no Sources buttons, so the sheet's scrolling body has nothing focusable (aud-5).
    const one = answer([cite(1)]);
    mockApi({ "GET /v1/messages/m1/sources/1": () => cited(1) });
    renderChat({ kind: "message" }, thread(one));
    await userEvent.click(await screen.findByRole("button", { name: "Used 1 source" }));
    await userEvent.click(screen.getByRole("button", { name: "Show source 1: Fees 1" }));
    const sheet = await screen.findByRole("dialog", { name: "Fees 1" });
    expect(sheet).toHaveAttribute("data-size", "full");
    expect(sheet).toHaveAccessibleDescription("Source 1 of 1");
    // Focus on the title, as on the desktop (aud-6, mem-10).
    await waitFor(() => expect(within(sheet).getByRole("heading", { name: "Fees 1" })).toHaveFocus());
    const passage = await within(sheet).findByTestId("cited-passage");
    // The cited passage is scrolled into view (mem-5, aud-5), and the body can be scrolled by keyboard.
    await waitFor(() => expect(scrolled.mock.contexts).toContain(passage));
    expect(await within(sheet).findByRole("region", { name: "Fees 1" })).toHaveAttribute("tabindex", "0");
    expect(await axe(sheet)).toHaveNoViolations();
    // The same close as the side panel's, first in the sheet (an arrow back, apart from the widget's own ×; mem-8).
    const close = within(sheet).getByRole("button", { name: "Close the source" });
    expect(within(sheet).getAllByRole("button")[0]).toBe(close);
    await userEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("scrolls the side panel to the cited passage, and drops empty table headers and skipped heading levels from passages (mem-5, mem-9)", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const table = "## Hours\n\n|  |  |\n|---|---|\n| Mon | 9 to 5 |\n\n##### Contact\n\nCall the desk.";
    mockApi({ "GET /v1/messages/m1/sources/1": () => cited(1, { passages: [passage(4, table), passage(5, "Passage 1 about fees.", true)] }) });
    const { container } = renderChat({ kind: "message" });
    const viewer = await openSource(1);
    const cited1 = await within(viewer).findByTestId("cited-passage");
    await waitFor(() => expect(scrolled.mock.contexts).toContain(cited1));
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
    expect(await within(viewer).findByRole("heading", { name: "Contact" })).toHaveProperty("tagName", "H3");
    expect(within(viewer).getByRole("table").querySelector("thead")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps sources under the answer where there is no viewer (a transcript)", async () => {
    renderBare(<ChatMessages items={thread()} agent={{ name: "Helper" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Used 2 sources" }));
    expect(screen.queryByRole("button", { name: /^Show source 1/ })).toBeNull();
  });
});
