/* Chat links (v0.4.2 US-01): a ?c= link to a deleted or unknown conversation asks once, says so, and offers a new chat. */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Reply, mockApi, renderApp, shellRoutes, sse } from "./harness";

const card = {
  id: "ag1",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  slug: "registrar-assistant",
  name: "Registrar assistant",
  description: "Registration and records.",
  accentColor: "#0021a5",
  welcomeMessage: "Hi! Ask me about registration.",
  starterQuestions: ["How do I drop a class?"],
  citationMode: "snippet_link",
  status: "active",
};

const chatPath = "/a/registrar/registrar-assistant";
const missing = "00000000-0000-4000-8000-000000000000";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

describe("a link to a conversation that isn't there (US-01)", () => {
  it("asks once, says the conversation isn't available, and doesn't loop", async () => {
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/agents/registrar/registrar-assistant": () => card,
      [`GET /v1/conversations/${missing}`]: () => Reply.error(404, "not_found", "Not found."),
    });
    const { container } = renderApp(`${chatPath}?c=${missing}`);
    expect(await screen.findByRole("heading", { name: "This conversation isn't available." })).toBeInTheDocument();
    // Give a loop time to show itself: the old page alternated these two requests ~70 times a second.
    await new Promise((r) => setTimeout(r, 400));
    expect(calls.filter((c) => c.url === `/v1/conversations/${missing}`)).toHaveLength(1);
    // The chat's own list (the sidebar's recent conversations ask separately).
    expect(calls.filter((c) => c.url === "/v1/conversations" && c.search.get("agentId") === "ag1")).toHaveLength(1);
    expect(screen.queryByText("Loading the agent…")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("starts a new chat from the notice, and a question typed there starts a new conversation", async () => {
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/agents/registrar/registrar-assistant": () => card,
      "POST /v1/agents/registrar/registrar-assistant/chat": () =>
        sse([
          ["conversation", { conversationId: "c2", userMessageId: "u", agentVersion: 1 }],
          ["message_start", { messageId: "m1" }],
          ["message_end", { messageId: "m1", stopReason: "stop", text: "Use the portal.", citations: [], refused: false, noContext: false }],
          ["done", {}],
        ]),
    });
    const { router } = renderApp(`${chatPath}?c=${missing}`);
    await screen.findByRole("heading", { name: "This conversation isn't available." });
    await userEvent.type(screen.getByRole("textbox", { name: "Message Registrar assistant" }), "How do I drop?{Enter}");
    expect(await screen.findByText("Use the portal.")).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({ message: "How do I drop?", conversationId: undefined, stream: true });
    await waitFor(() => expect(router.state.location.search).toEqual({ c: "c2" }));

    await userEvent.click(screen.getByRole("button", { name: /New conversation/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it("the notice's button opens a new chat", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/agents/registrar/registrar-assistant": () => card });
    const { router } = renderApp(`${chatPath}?c=${missing}`);
    await userEvent.click(await screen.findByRole("button", { name: "Start a new chat" }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await screen.findByText("Hi! Ask me about registration.")).toBeInTheDocument();
  });
});
