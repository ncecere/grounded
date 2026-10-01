/* An answer's progress before its first words: status events, the waiting text and the polite screen-reader status (one update per step). */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { progressAnnouncement, stepLabel, waitingText } from "../pages/chat/progress";
import { applyChatEvent, pendingAssistant } from "../pages/chat/stream";
import { mockApi, renderApp, shellRoutes } from "./harness";

const card = {
  id: "ag1", teamSlug: "registrar", teamName: "Office of the Registrar", slug: "registrar-assistant", name: "Registrar assistant",
  description: "Registration and records.", accentColor: "#0021a5", welcomeMessage: "Hi!", starterQuestions: [], citationMode: "snippet_link", status: "active",
};
const usage = { input: 900, output: 120, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 1020 };

/** A stream the test writes events to, one at a time. */
function liveStream() {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
  return {
    response: () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    send: (event: string, data: unknown) => ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    close: () => ctl.close(),
  };
}

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

describe("progress labels", () => {
  it("names each step, ignores unknown ones and falls back for servers without status events", () => {
    let item = pendingAssistant();
    expect(waitingText(item, false, "Fees")).toBe("Working on it…");
    item = applyChatEvent(item, "status", { step: "searching" });
    expect(item.step).toBe("searching");
    expect(waitingText(item, false, "Fees")).toBe("Searching Fees' knowledge…");
    expect(waitingText(item, false, "Help Desk")).toBe("Searching Help Desk's knowledge…");
    expect(applyChatEvent(item, "status", { step: "translating" }).step).toBe("searching");
    expect(stepLabel("rewriting", "Fees")).toBe("Understanding the question…");
    expect(stepLabel("checking", "Fees")).toBe("Checking the passages…");
    expect(stepLabel("answering", "Fees")).toBe("Writing the answer…");
    // A reasoning model's thinking says "Thinking…"; a buffered answer is written and checked before it's shown.
    expect(waitingText({ ...item, step: "answering" }, true, "Fees")).toBe("Thinking…");
    expect(waitingText({ ...item, step: "answering", buffered: true }, false, "Fees")).toBe("Writing and checking the answer…");
    expect(waitingText({ ...item, step: "checking", buffered: true }, false, "Fees")).toBe("Checking the passages…");
    expect(progressAnnouncement([{ ...item, step: "answering", buffered: true }], "Fees")).toBe("Writing and checking the answer…");
    // Checked paragraphs (stream_checked) are written and checked until the first one is shown.
    const checked = applyChatEvent({ ...item, step: "answering" }, "message_start", { messageId: "m1", mode: "stream_checked" });
    expect(checked.checked && !checked.buffered).toBe(true);
    expect(waitingText(checked, false, "Fees")).toBe("Writing and checking the answer…");
    expect(progressAnnouncement([checked], "Fees")).toBe("Writing and checking the answer…");
    expect(applyChatEvent(item, "message_start", { messageId: "m1", mode: "stream_retract" }).checked).toBe(false);
    // Nothing to announce once words arrive, or for a finished answer.
    expect(progressAnnouncement([item], "Fees")).toBe("Searching Fees' knowledge…");
    expect(progressAnnouncement([{ ...item, text: "Use" }], "Fees")).toBe("");
    expect(progressAnnouncement([{ ...item, status: "done" }], "Fees")).toBe("");
  });
});

describe("chat progress", () => {
  it("shows and politely announces each step until the first words", async () => {
    const stream = liveStream();
    mockApi({
      ...shellRoutes(),
      "GET /v1/agents/registrar/registrar-assistant": () => card,
      "GET /v1/agents": () => [card],
      "POST /v1/agents/registrar/registrar-assistant/chat": () => stream.response(),
    });
    const { container } = renderApp("/a/registrar/registrar-assistant");
    await userEvent.type(await screen.findByRole("textbox", { name: "Message Registrar assistant" }), "And the fee?{Enter}");
    const announced = (text: string) => screen.getAllByRole("status").some((el) => el.textContent?.trim() === text);

    stream.send("conversation", { conversationId: "c1", userMessageId: "u1", agentVersion: 1 });
    const steps: [string, string][] = [
      ["rewriting", "Understanding the question…"],
      ["searching", "Searching Registrar assistant's knowledge…"],
      ["checking", "Checking the passages…"],
    ];
    for (const [step, label] of steps) {
      stream.send("status", { step });
      // Shown under the avatar and said once by the status region.
      await waitFor(() => expect(announced(label)).toBe(true));
      expect(screen.getAllByText(label)).toHaveLength(2);
    }
    stream.send("retrieval", { query: "transcript fee", hits: [{ n: 1, title: "Fees", snippet: "Ten dollars." }] });
    stream.send("status", { step: "answering" });
    await waitFor(() => expect(announced("Writing the answer…")).toBe(true));
    expect(screen.getAllByText("Writing the answer…")).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();

    // The first words replace the waiting text, and the status region falls silent.
    stream.send("message_start", { messageId: "m1" });
    stream.send("text_delta", { delta: "Ten dollars [1]." });
    await waitFor(() => expect(screen.queryByText("Writing the answer…")).toBeNull());
    expect(announced("Writing the answer…")).toBe(false);
    stream.send("message_end", { messageId: "m1", stopReason: "stop", text: "Ten dollars [1].", citations: [], usage, refused: false, noContext: false });
    stream.send("done", {});
    stream.close();
    await waitFor(() => expect(announced("Answer ready")).toBe(true));
  });
});

describe("checked paragraphs", () => {
  it("says the answer is written and checked until the first paragraph, then follows it as it grows", async () => {
    const stream = liveStream();
    mockApi({
      ...shellRoutes(),
      "GET /v1/agents/registrar/registrar-assistant": () => card,
      "GET /v1/agents": () => [card],
      "POST /v1/agents/registrar/registrar-assistant/chat": () => stream.response(),
    });
    const { container } = renderApp("/a/registrar/registrar-assistant");
    await userEvent.type(await screen.findByRole("textbox", { name: "Message Registrar assistant" }), "And the fee?{Enter}");
    const announced = (text: string) => screen.getAllByRole("status").some((el) => el.textContent?.trim() === text);

    stream.send("conversation", { conversationId: "c1", userMessageId: "u1", agentVersion: 1 });
    stream.send("status", { step: "answering" });
    stream.send("message_start", { messageId: "m1", mode: "stream_checked" });
    await waitFor(() => expect(announced("Writing and checking the answer…")).toBe(true));
    expect(screen.getAllByText("Writing and checking the answer…")).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();

    // Each checked paragraph is shown as it is released.
    stream.send("text_delta", { delta: "Transcripts cost ten dollars.\n\n" });
    await screen.findByText("Transcripts cost ten dollars.");
    expect(screen.queryByText("Writing and checking the answer…")).toBeNull();
    stream.send("text_delta", { delta: "Rush orders cost more." });
    await screen.findByText("Rush orders cost more.");
    expect(screen.getByText("Transcripts cost ten dollars.")).toBeInTheDocument();

    // A later paragraph fails: the notice replaces the whole answer.
    const notice = "This message can't be answered because it may break the usage policy.";
    stream.send("moderation", { stage: "output", action: "retracted", category: "violence", notice });
    stream.send("message_end", { messageId: "m1", stopReason: "stop", text: notice, citations: [], usage, refused: false, noContext: false });
    stream.send("done", {});
    stream.close();
    await screen.findByText(notice);
    expect(screen.queryByText("Transcripts cost ten dollars.")).toBeNull();
  });
});
