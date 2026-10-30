/* Parent sections (#20, docs/parent-child-retrieval.md): the profile form, the profile's page, the index preview's field and the source viewer's cited section, with axe on each. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { parentProblem, parentSummary } from "../pages/admin/models/parent-size";
import { initialProfileForm, profileBody, profileErrors } from "../pages/admin/models/profile-form";
import { type AssistantItem, type ChatItem, applyChatEvent, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { ViewerHost } from "../pages/chat/viewer/host";
import { type ViewerAccess } from "../pages/chat/viewer/data";
import { Reply, mockApi, renderApp, renderBare, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const stamp = { revision: 3, createdAt: "2026-10-30T10:00:00Z", updatedAt: "2026-10-30T10:00:00Z" };
const embed = {
  id: "m2", connectionId: "c1", key: "embed", upstreamModel: "embed-1", displayName: "Embeddings", description: "", kind: "embedding",
  maxClassification: "open", enabled: true, supportsTools: false, supportsVision: false, dimensions: 768, compat: {}, ...stamp,
};
const profile = (over: Partial<Schemas["EmbeddingProfile"]> = {}): Schemas["EmbeddingProfile"] => ({
  id: "p1", key: "nomic-768", name: "Nomic 768", description: "", model: { id: "m2", key: "embed", displayName: "Embeddings", maxClassification: "open", enabled: true },
  dimensions: 768, storageType: "halfvec", documentPrefix: "", queryPrefix: "", chunkSize: 512, chunkOverlap: 64, chunkerVersion: 1, parentTokens: 0, status: "active", isDefault: true, ...stamp, ...over,
});

describe("parent size checks", () => {
  it("accepts nothing and 0 (off) and a size of at least two passages and at most 8192", () => {
    expect(["", " ", "0", "1024", "8192"].map((t) => parentProblem(t, 512))).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(parentProblem("1023", 512)).toBe("At least twice the passage size: 1024 tokens.");
    expect(parentProblem("8193", 128)).toBe("At most 8192 tokens.");
    expect(parentProblem("12.5", 128)).toBe("Enter a whole number of tokens, or 0 for none.");
    expect(parentProblem("-3", 128)).toBe("Enter a whole number of tokens, or 0 for none.");
    expect(parentProblem("abc", 128)).toBe("Enter a whole number of tokens, or 0 for none.");
    expect(parentSummary(0)).toBe("no parent sections");
    expect(parentSummary(2048)).toBe("parent sections up to 2048 tokens");
  });

  it("leaves the field out of the request unless a size is chosen (off is the default)", () => {
    expect("parentTokens" in profileBody(initialProfileForm, "m2")).toBe(false);
    expect("parentTokens" in profileBody({ ...initialProfileForm, parentTokens: "0" }, "m2")).toBe(false);
    expect(profileBody({ ...initialProfileForm, parentTokens: "2048" }, "m2").parentTokens).toBe(2048);
    expect(profileErrors({ ...initialProfileForm, parentTokens: "100" }, undefined).parentTokens).toMatch(/twice the passage size/);
    expect(profileErrors(initialProfileForm, undefined).parentTokens).toBeUndefined();
  });
});

describe("the profile form", () => {
  const routes = (calls: Record<string, (b: unknown) => unknown> = {}) => ({
    ...shellRoutes("platform_admin"),
    "GET /v1/admin/models": () => [embed],
    "GET /v1/admin/embedding-profiles": () => [profile()],
    ...calls,
  });

  it("has an accessible Parent sections field that is off unless a size is typed", async () => {
    const calls = mockApi(routes({ "POST /v1/admin/embedding-profiles": () => profile() }));
    renderApp("/admin/embedding-profiles");
    await userEvent.click(await screen.findByRole("button", { name: "Add profile" }, { timeout: scaled(4000) }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByRole("textbox", { name: /Parent sections/ });
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "Off");
    expect(field).toHaveAccessibleDescription(/Not measured on a real knowledge base/);
    expect(field).toHaveAccessibleDescription(/at most 8192/);
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Plain");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create profile" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect("parentTokens" in (calls.find((c) => c.method === "POST")!.body as object)).toBe(false);
  });

  it("checks the size against the passage size, then sends it", async () => {
    const calls = mockApi(routes({ "POST /v1/admin/embedding-profiles": () => profile({ parentTokens: 2048 }) }));
    renderApp("/admin/embedding-profiles");
    await userEvent.click(await screen.findByRole("button", { name: "Add profile" }, { timeout: scaled(4000) }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "With parents");
    const field = within(dialog).getByRole("textbox", { name: /Parent sections/ });
    await userEvent.type(field, "600");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create profile" }));
    expect(await within(dialog).findByText("At least twice the passage size: 1024 tokens.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.clear(field);
    await userEvent.type(field, "2048");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create profile" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({ name: "With parents", parentTokens: 2048 });
  });

  it("shows the server's refusal at the field", async () => {
    mockApi(routes({ "POST /v1/admin/embedding-profiles": () => Reply.error(400, "invalid_parent_tokens", "The parent size must be 0 (no parents) or between twice the passage size (1024) and 8192 tokens") }));
    renderApp("/admin/embedding-profiles");
    await userEvent.click(await screen.findByRole("button", { name: "Add profile" }, { timeout: scaled(4000) }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Refused");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create profile" }));
    expect(await within(dialog).findByText(/The parent size must be 0/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/The parent size must be 0/)).toHaveLength(1); // at the field, not also in an alert
  });

  it("says on a profile's page whether it has parent sections", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/embedding-profiles": () => [profile({ parentTokens: 2048 }), profile({ id: "p2", key: "plain", name: "Plain", isDefault: false })] });
    const first = renderApp("/admin/embedding-profiles?record=p1");
    const sheet = await screen.findByRole("region", { name: "Nomic 768" }, { timeout: scaled(4000) });
    expect(within(sheet).getByText("Parent sections")).toBeInTheDocument();
    expect(within(sheet).getByText("Up to 2048 tokens around each passage, for an agent's model")).toBeInTheDocument();
    expect(await axe(first.container)).toHaveNoViolations();
    first.unmount();
    renderApp("/admin/embedding-profiles?record=p2");
    const plain = await screen.findByRole("region", { name: "Plain" }, { timeout: scaled(4000) });
    expect(within(plain).getByText("Parent sections").nextElementSibling).toHaveTextContent("None");
  });
});

describe("the index preview", () => {
  const kbs = [{ id: "k1", name: "Student handbook", teamSlug: "registrar", teamName: "Office of the Registrar", profile: { id: "p1", name: "Nomic 768" }, sources: 2, passages: 320, migration: null }];
  const held = {
    id: "m9", status: "running", hold: true, canSwitch: false, kb: { id: "k1", name: "Student handbook" }, teamSlug: "registrar", teamName: "Office of the Registrar",
    fromProfile: { id: "p1", name: "Nomic 768" }, toProfile: { id: "p9", name: "Nomic 768 (new settings)" }, graceDays: 7, startedAt: "2026-10-30T09:00:00Z",
    estimate: { documents: 40, passages: 320, tokens: 51200, embeddingCalls: 5, requestsPerMinute: 110, minutes: 0.05, rechunk: true },
    startedBy: { id: "u9", displayName: "Pat Admin", email: "pat@example.edu" }, switchedAt: null, oldVectorsUntil: null, finishedAt: null, canSwitchBack: false,
    progress: { sources: 2, sourcesComplete: 1, documents: 40, done: 12, failed: 0, waiting: 0 }, revision: 6,
  };
  const routes = (current = profile()) => ({
    ...shellRoutes("platform_admin"),
    "GET /v1/admin/profile-migrations": () => [],
    "GET /v1/admin/profile-migrations/m9": () => held,
    "GET /v1/admin/knowledge-bases": () => kbs,
    "GET /v1/admin/embedding-profiles": () => [current],
    "GET /v1/admin/models": () => [embed],
    "POST /v1/admin/profile-migrations/preview": () => held,
  });
  const open = async () => {
    const calls = mockApi(routes());
    renderApp("/admin/embedding-profiles?tab=migrations&preview=k1");
    const dialog = await screen.findByRole("dialog", { name: "Preview new settings" }, { timeout: scaled(4000) });
    // The fields are off until the knowledge base is known: type once it is.
    await within(dialog).findByText(/Now: Nomic 768/);
    return { calls, dialog };
  };

  it("says what the knowledge base has now, keeps the setting unless one is typed, and passes axe", async () => {
    const { calls, dialog } = await open();
    expect(await within(dialog).findByText(/512 tokens per passage, 64 overlap, standard chunker, no parent sections/)).toBeInTheDocument();
    const field = within(dialog).getByRole("textbox", { name: /Parent sections/ });
    expect(field).toHaveValue("");
    expect(field).toHaveAccessibleDescription(/Empty keeps the current setting, 0 turns it off/);
    expect(field).toHaveAccessibleDescription(/measures which pages are found, not how good the answers are/);
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Build the new index" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/admin/profile-migrations/preview")).toBe(true));
    expect(calls.find((c) => c.url === "/v1/admin/profile-migrations/preview")!.body).toEqual({ kbId: "k1", changes: {} });
  });

  it("sends a parent size, and 0 to turn parent sections off", async () => {
    const { calls, dialog } = await open();
    const field = within(dialog).getByRole("textbox", { name: /Parent sections/ });
    await userEvent.type(field, "1024");
    await userEvent.click(within(dialog).getByRole("button", { name: "Build the new index" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/admin/profile-migrations/preview")).toBe(true));
    expect(calls.find((c) => c.url === "/v1/admin/profile-migrations/preview")!.body).toEqual({ kbId: "k1", changes: { parentTokens: 1024 } });
  });

  it("checks the size against the passage size being previewed and holds the button back", async () => {
    const { calls, dialog } = await open();
    const field = within(dialog).getByRole("textbox", { name: /Parent sections/ });
    await userEvent.type(field, "1024");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Passage size/ }), "768");
    // 1024 holds one passage of 768, not two.
    expect(await within(dialog).findByText("At least twice the passage size: 1536 tokens.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Build the new index" })).toBeDisabled();
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.clear(field);
    await userEvent.type(field, "0");
    expect(within(dialog).getByRole("button", { name: "Build the new index" })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Build the new index" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/admin/profile-migrations/preview")).toBe(true));
    expect(calls.find((c) => c.url === "/v1/admin/profile-migrations/preview")!.body).toEqual({ kbId: "k1", changes: { chunkSize: 768, parentTokens: 0 } });
  });

  it("names the parent size the knowledge base has now", async () => {
    mockApi(routes(profile({ parentTokens: 2048 })));
    renderApp("/admin/embedding-profiles?tab=migrations&preview=k1");
    const dialog = await screen.findByRole("dialog", { name: "Preview new settings" }, { timeout: scaled(4000) });
    expect(await within(dialog).findByText(/standard chunker, parent sections up to 2048 tokens/)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Parent sections/ })).toHaveAttribute("placeholder", "2048");
  });
});

describe("the source viewer's cited section", () => {
  const parent: Schemas["CitationParent"] = { first: 4, last: 6, passages: 3, tokens: 380, matched: 2, sha256: "a".repeat(64) };
  const cite = (extra: Partial<Schemas["Citation"]> = {}): Schemas["Citation"] => ({
    n: 1, documentId: "d1", sourceId: "s1", title: "Fees", snippet: "Official transcripts are ordered online.", headingPath: ["Fees"], chunkId: "c5", parent, ...extra,
  });
  const text = "Transcripts cost $10 [1].";
  const item = (): AssistantItem => {
    let a = applyChatEvent(pendingAssistant(), "message_start", { messageId: "m1" });
    a = applyChatEvent(a, "message_end", { messageId: "m1", stopReason: "stop", text, citations: [cite()], refused: false, noContext: false });
    return applyChatEvent(a, "done", {});
  };
  const items = (): ChatItem[] => [{ role: "user", key: "u1", text: "What does a transcript cost?" }, item()];
  const passage = (ordinal: number, content: string, matched = false) => ({ ordinal, content, headingPath: ["Fees"], pageStart: 0, pageEnd: 0, cited: true, ...(matched ? { matched: true } : {}) });
  const section = (extra: Partial<Schemas["CitedPassage"]> = {}): Schemas["CitedPassage"] => ({
    n: 1, status: "available", documentId: "d1", sourceId: "s1", title: "Fees", headingPath: ["Fees"], parent,
    passages: [passage(4, "Transcripts are ordered online."), passage(5, "A transcript costs $10.", true), passage(6, "Pick-up is at the front desk.")], claims: [], ...extra,
  });
  const render = (access: ViewerAccess) => {
    const list = items();
    return renderBare(
      <main>
        <ViewerHost access={access} items={list}>
          <ChatMessages items={list} agent={{ name: "Helper" }} />
        </ViewerHost>
      </main>,
    );
  };
  const openIt = async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Used 1 source" }));
    await userEvent.click(screen.getByRole("button", { name: /^Show source 1: Fees/i }));
    return screen.findByRole("region", { name: "Fees" });
  };

  it("shows the whole section in the authorized editor view, with the matched passage named", async () => {
    mockApi({ "GET /v1/teams/registrar/sources/s1/documents/d1/text": () => ({ documentId: "d1", sourceId: "s1", title: "Fees", kind: "markdown", total: 30, from: 4, items: section().passages }) });
    const { container } = render({ kind: "team", team: "registrar" });
    const viewer = await openIt();
    const block = await within(viewer).findByTestId("cited-section");
    expect(within(block).getByText("Cited section")).toBeInTheDocument();
    expect(block).toHaveTextContent(/The model was given these 3 passages together/);
    expect(block).toHaveTextContent(/2 passages of this section matched/);
    expect(within(block).getByTestId("matched-passage")).toHaveTextContent("A transcript costs $10.");
    expect(within(block).getByTestId("matched-passage")).toHaveTextContent("Matched passage");
    expect(block).toHaveTextContent("Transcripts are ordered online.");
    expect(block).toHaveTextContent("Pick-up is at the front desk.");
    expect(within(viewer).queryByTestId("cited-passage")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("does not describe the bounded cited window as the full generation section", async () => {
    mockApi({ "GET /v1/messages/m1/sources/1": () => section({
      parent: { ...parent, last: 27, passages: 24 },
      passages: section().passages.map((p) => ({ ...p, cited: p.ordinal === 5, matched: p.ordinal === 5 })),
    }) });
    const { container } = render({ kind: "message" });
    const viewer = await openIt();
    expect(await within(viewer).findByText(/The model used a larger section \(24 passages\)/)).toHaveTextContent("This view shows the matched passage and nearby context.");
    expect(within(viewer).getByTestId("cited-passage")).toHaveTextContent("A transcript costs $10.");
    expect(within(viewer).queryByTestId("cited-section")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says the section changed instead of showing other text as the cited one", async () => {
    mockApi({ "GET /v1/messages/m1/sources/1": () => section({ status: "passage_changed", passages: [] }) });
    const { container } = render({ kind: "message" });
    const viewer = await openIt();
    expect(await within(viewer).findByText("This section is no longer in the document. The document changed after the answer was written.")).toBeInTheDocument();
    expect(within(viewer).getByText("What the answer quoted:")).toBeInTheDocument();
    expect(within(viewer).queryByTestId("cited-section")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("asks the team's document endpoint for the section by its range and hash in Try it", async () => {
    const calls = mockApi({ "GET /v1/teams/registrar/sources/s1/documents/d1/text": () => ({ documentId: "d1", sourceId: "s1", title: "Fees", kind: "markdown", total: 30, from: 4, items: section().passages }) });
    render({ kind: "team", team: "registrar" });
    const viewer = await openIt();
    expect(await within(viewer).findByTestId("cited-section")).toHaveTextContent("A transcript costs $10.");
    const call = calls.find((c) => c.url.endsWith("/documents/d1/text"))!;
    expect(call.search.get("around")).toBe("c5");
    expect(call.search.get("parentFirst")).toBe("4");
    expect(call.search.get("parentLast")).toBe("6");
    expect(call.search.get("parentSha256")).toBe("a".repeat(64));
  });

  it("shows a passage as before when the model was given the passage", async () => {
    let a = applyChatEvent(pendingAssistant(), "message_start", { messageId: "m1" });
    a = applyChatEvent(a, "message_end", { messageId: "m1", stopReason: "stop", text, citations: [cite({ parent: undefined })], refused: false, noContext: false });
    const list: ChatItem[] = [{ role: "user", key: "u1", text: "q" }, applyChatEvent(a, "done", {})];
    mockApi({ "GET /v1/messages/m1/sources/1": () => ({ ...section(), parent: undefined, passages: [{ ordinal: 5, content: "A transcript costs $10.", headingPath: ["Fees"], pageStart: 0, pageEnd: 0, cited: true }] }) });
    renderBare(
      <main>
        <ViewerHost access={{ kind: "message" }} items={list}>
          <ChatMessages items={list} agent={{ name: "Helper" }} />
        </ViewerHost>
      </main>,
    );
    const viewer = await openIt();
    expect(await within(viewer).findByTestId("cited-passage")).toHaveTextContent("A transcript costs $10.");
    expect(within(viewer).queryByTestId("cited-section")).toBeNull();
  });
});
