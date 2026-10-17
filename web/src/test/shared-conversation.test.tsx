/* Sharing a conversation (v0.6.0, C12): the Share… dialog on a conversation, and the shared page a link opens. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { entryTitle } from "../components/audit/labels";
import { itemsFromShared } from "../pages/shared/data";
import { type Handler, Reply, mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const conv = {
  id: "c1",
  agentId: "a1",
  agentName: "Registrar assistant",
  agentSlug: "registrar-assistant",
  teamSlug: "registrar",
  agentDeleted: false,
  title: "Parking permits",
  createdAt: "2026-10-16T09:00:00Z",
  updatedAt: "2026-10-16T09:30:00Z",
};
const card = (audience: string) => ({
  id: "a1", teamSlug: "registrar", teamName: "Office of the Registrar", slug: "registrar-assistant", name: "Registrar assistant", description: "", accentColor: "",
  welcomeMessage: "", starterQuestions: [], citationMode: "snippet_link", status: "active", audience,
});
const share = (extra: Partial<Schemas["ConversationShare"]> = {}): Schemas["ConversationShare"] => ({
  id: "s1", audience: "agent_users", showName: false, upToSeq: 2, messageCount: 2, createdAt: "2026-10-16T09:40:00Z", ...extra,
});

const dialogRoutes = (audience: string, extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes(),
  "GET /v1/agents": () => [],
  "GET /v1/conversations": () => ({ items: [conv], nextCursor: null }),
  "GET /v1/agents/registrar/registrar-assistant": () => card(audience),
  "GET /v1/conversations/c1/shares": () => [],
  ...extra,
});

async function openShare() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Actions for Parking permits" }, { timeout: scaled(5000) }));
  await user.click(await screen.findByRole("menuitem", { name: "Share…" }));
  return { user, dialog: await screen.findByRole("dialog", { name: "Share this conversation" }) };
}

describe("Share… on a conversation", () => {
  it("warns before the link exists, offers who can open it, creates the link and shows it once", async () => {
    const calls = mockApi(
      dialogRoutes("all_authenticated", {
        "POST /v1/conversations/c1/shares": () => new Reply(201, { data: { share: share(), token: "t".repeat(43), url: `https://grounded.example/shared/${"t".repeat(43)}` } }),
      }),
    );
    const { container } = renderApp("/conversations");
    const { user, dialog } = await openShare();
    expect(dialog).toHaveTextContent("Anyone who opens the link can read this conversation");
    expect(dialog).toHaveTextContent("You can't take back what someone has already read");
    // A link for everyone is offered only for a public agent.
    expect(within(dialog).getByRole("radio", { name: /People who can use Registrar assistant/ })).toBeChecked();
    expect(within(dialog).queryByRole("radio", { name: /Anyone with the link/ })).toBeNull();
    expect(dialog).toHaveTextContent("Anyone who is signed in can open it, after they sign in.");
    expect(within(dialog).getByRole("checkbox", { name: /Show my name/ })).not.toBeChecked();
    expect(dialog).toHaveTextContent("You haven't made a link to this conversation.");
    expect(await axe(container)).toHaveNoViolations();

    await user.click(within(dialog).getByRole("checkbox", { name: /Show my name/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));
    // The link is plain selectable text with a Copy button, shown in the dialog now and never again.
    expect(await within(dialog).findByText(`https://grounded.example/shared/${"t".repeat(43)}`)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Copy link/ })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("it is shown only once");
    expect(calls.find((c) => c.method === "POST" && c.url === "/v1/conversations/c1/shares")?.body).toEqual({ audience: "agent_users", showName: true });
  });

  it("offers a link for anyone on a public agent, and says so when the server refuses it", async () => {
    const calls = mockApi(
      dialogRoutes("public", {
        "POST /v1/conversations/c1/shares": () => Reply.error(409, "public_share_unavailable", "A link open to anyone needs a public agent and public access turned on"),
      }),
    );
    renderApp("/conversations");
    const { user, dialog } = await openShare();
    await user.click(await within(dialog).findByRole("radio", { name: /Anyone with the link/ }));
    expect(dialog).toHaveTextContent("No sign-in needed");
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));
    expect(await within(dialog).findByText("A link open to anyone isn't available")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ audience: "anyone", showName: false });
    // Choosing the other option clears the message.
    await user.click(within(dialog).getByRole("radio", { name: /People who can use Registrar assistant/ }));
    await waitFor(() => expect(within(dialog).queryByText("A link open to anyone isn't available")).toBeNull());
  });

  it("lists the links made, and revokes one only after confirmation", async () => {
    let links = [share(), share({ id: "s2", audience: "anyone", showName: true, messageCount: 4 })];
    const calls = mockApi(
      dialogRoutes("public", {
        "GET /v1/conversations/c1/shares": () => links,
        "DELETE /v1/conversations/c1/shares/s1": () => {
          links = links.filter((l) => l.id !== "s1");
          return { ok: true };
        },
      }),
    );
    renderApp("/conversations");
    const { user, dialog } = await openShare();
    const list = await within(dialog).findByRole("list", { name: "Links to this conversation" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(list).toHaveTextContent("Anyone with the link");
    expect(list).toHaveTextContent("your name shown");
    expect(list).toHaveTextContent("4 messages");

    await user.click(within(list).getAllByRole("button", { name: /Revoke the link made/ })[0]!);
    let confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("It stops opening at once");
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    await user.click(within(list).getAllByRole("button", { name: /Revoke the link made/ })[0]!);
    confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Revoke link" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(1));
  });

  it("cannot share a conversation with a deleted agent", async () => {
    mockApi({ ...dialogRoutes("team"), "GET /v1/conversations": () => ({ items: [{ ...conv, agentDeleted: true }], nextCursor: null }) });
    renderApp("/conversations");
    const { dialog } = await openShare();
    expect(dialog).toHaveTextContent("This agent was deleted");
    expect(within(dialog).queryByRole("button", { name: "Create link" })).toBeNull();
  });
});

const shared = (extra: Partial<Schemas["SharedConversation"]> = {}): Schemas["SharedConversation"] => ({
  title: "Parking permits",
  agent: { name: "Registrar assistant", slug: "registrar-assistant", teamSlug: "registrar", description: "", accentColor: "" },
  sharedBy: "",
  sharedAt: "2026-10-16T09:40:00Z",
  audience: "agent_users",
  owner: false,
  messages: [
    { id: "m1", seq: 1, role: "user", text: "Where do I buy a parking permit?", citations: [], createdAt: "2026-10-16T09:30:00Z" },
    {
      id: "m2", seq: 2, role: "assistant", text: "At the transportation office [1].", createdAt: "2026-10-16T09:30:05Z",
      citations: [{ n: 1, title: "Parking", snippet: "Permits are sold by Transportation Services.", headingPath: ["Permits"] }],
    },
  ],
  ...extra,
});

describe("the shared page", () => {
  it("shows the snapshot read-only: the questions, the answer and its source, no feedback, and a way to ask the agent", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/shared/tok": () => shared({ sharedBy: "Blair Dev" }) });
    const { container } = renderApp("/shared/tok");
    expect(await screen.findByRole("heading", { level: 1, name: "Parking permits" }, { timeout: scaled(5000) })).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "P" && /shared by Blair Dev/.test(el.textContent ?? ""))).toBeInTheDocument(); // the name is isolated in a <bdi> (#126)
    expect(screen.getByText("Where do I buy a parking permit?")).toBeInTheDocument();
    expect(await screen.findByText(/At the transportation office/)).toBeInTheDocument();
    expect(screen.getByText(/read-only copy of the conversation as it was when it was shared/)).toBeInTheDocument();
    // Read only: no composer and no feedback buttons.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /helpful|Good answer|Bad answer|thumbs/i })).toBeNull();
    expect(screen.getByRole("link", { name: /Ask Registrar assistant/ })).toHaveAttribute("href", "/a/registrar/registrar-assistant");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("tells its owner it is theirs, and opens a source through the link", async () => {
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/shared/tok": () => shared({ owner: true }),
      "GET /v1/shared/tok/messages/m2/sources/1": () => ({
        status: "available",
        citation: { n: 1, title: "Parking", snippet: "Permits are sold by Transportation Services.", headingPath: ["Permits"], documentId: "d1", sourceId: "s1" },
        headingPath: ["Permits"],
        passages: [{ id: "p1", ordinal: 1, headingPath: ["Permits"], content: "Permits are sold by Transportation Services.", cited: true }],
        claims: [],
      }),
    });
    renderApp("/shared/tok");
    expect(await screen.findByText(/You shared this conversation/, undefined, { timeout: scaled(5000) })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Used 1 source" }, { timeout: scaled(5000) }));
    await user.click(await screen.findByRole("button", { name: "Show source 1: Parking" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/shared/tok/messages/m2/sources/1")).toBe(true));
  });

  it("asks for a sign-in when the server does (a link for the agent's users, no session), and says it isn't available when it is not", async () => {
    mockApi({
      ...shellRoutes(),
      "GET /v1/me": () => null,
      "GET /v1/shared/tok": () => Reply.error(401, "sign_in_required", "Sign in to open this shared conversation"),
    });
    const first = renderApp("/shared/tok");
    expect(await screen.findByRole("heading", { name: "Sign in to open this conversation" }, { timeout: scaled(5000) })).toBeInTheDocument();
    const signIn = screen.getAllByRole("link", { name: /Sign in/ }).at(-1)!;
    expect(signIn.getAttribute("href")).toContain("next=%2Fshared%2Ftok");
    first.unmount();

    mockApi({ ...shellRoutes(), "GET /v1/shared/gone": () => Reply.error(404, "share_not_found", "Shared conversation not found") });
    renderApp("/shared/gone");
    expect(await screen.findByRole("heading", { name: "This conversation isn't available" }, { timeout: scaled(5000) })).toBeInTheDocument();
    expect(screen.queryByText(/Registrar assistant/)).toBeNull();
  });

  it("asks not to be sent on as a referrer while it is open", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/shared/tok": () => shared() });
    const page = renderApp("/shared/tok");
    await screen.findByRole("heading", { level: 1, name: "Parking permits" }, { timeout: scaled(5000) });
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute("content")).toBe("no-referrer");
    page.unmount();
    expect(document.head.querySelector('meta[name="referrer"]')).toBeNull();
  });
});

describe("a shared message as a chat item", () => {
  it("is the question and the answer with its citations, a stopped answer is marked, a failure is an error and a moderation notice reads as the answer", () => {
    const base = { seq: 2, role: "assistant" as const, text: "x", citations: [], createdAt: "2026-10-16T09:00:00Z" };
    const items = itemsFromShared([
      { id: "q", seq: 1, role: "user", text: "Question?", citations: [], createdAt: "2026-10-16T09:00:00Z" },
      { ...base, id: "a1", citations: [{ n: 1, title: "Parking", snippet: "s", headingPath: [], kind: "tool", server: "Status", tool: "check" }] },
      { ...base, id: "a2", stopped: true },
      { ...base, id: "a3", errorCode: "model_error" },
      { ...base, id: "a4", text: "I can't help with that.", errorCode: "moderation_blocked" },
    ]);
    expect(items[0]).toMatchObject({ role: "user", text: "Question?" });
    expect(items[1]).toMatchObject({ role: "assistant", status: "done", citations: [{ n: 1, kind: "tool", server: "Status" }] });
    expect(items[2]).toMatchObject({ status: "aborted" });
    expect(items[3]).toMatchObject({ status: "error", error: { code: "model_error" } });
    expect(items[4]).toMatchObject({ status: "done", text: "I can't help with that." });
    // Nothing the agent did to answer is part of a shared answer.
    for (const it of items.slice(1)) expect(it).toMatchObject({ thinking: "", steps: [], sources: [] });
  });
});

describe("audit log wording", () => {
  it("names the link actions in words", () => {
    const e = (action: string) => ({ action, after: null, targetLabel: "Shared conversation" });
    expect(entryTitle(e("conversation_share.create"))).toBe("Made a link to a conversation: Shared conversation");
    expect(entryTitle(e("conversation_share.revoke"))).toBe("Revoked a link to a conversation: Shared conversation");
  });
});
