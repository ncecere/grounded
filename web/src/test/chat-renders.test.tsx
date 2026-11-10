/*
 * What a streamed token and a typed character render (the hard pass on the chat page): the answer they belong to, not
 * every answer above it. An answer's render is counted through its notes (every answer renders them, with its item).
 * And a citation chip stays the same element while its answer streams: react-markdown used to get new renderer
 * functions with each token, which React treats as new components, so an open card closed mid-answer.
 */
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ChatPanel } from "../pages/chat/panel";
import { type AssistantItem, type ChatItem, applyChatEvent, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import type { useChat } from "../pages/chat/useChat";
import { findParagraph, renderBare } from "./harness";

const renders = new Map<string, number>();
vi.mock("../pages/chat/notes", async (original) => {
  const real = await original<typeof import("../pages/chat/notes")>();
  return {
    ...real,
    Notes(props: Parameters<typeof real.Notes>[0]) {
      renders.set(props.item.key, (renders.get(props.item.key) ?? 0) + 1);
      return real.Notes(props);
    },
  };
});

beforeEach(() => renders.clear());

/** A finished answer with one cited source. */
function finished(n: number): ChatItem[] {
  let a: AssistantItem = { ...pendingAssistant(), key: `a${n}` };
  a = applyChatEvent(a, "retrieval", { query: `question ${n}`, hits: [{ n: 1, title: "Wi-Fi", snippet: "Three networks." }] });
  a = applyChatEvent(a, "message_end", { messageId: `m${n}`, stopReason: "stop", text: `Answer ${n} [1].`, citations: [], refused: false, noContext: false });
  return [{ role: "user", key: `u${n}`, text: `Question ${n}?` }, applyChatEvent(a, "done", {})];
}

/** The answer being written: a source found, then its first words. */
function live(): AssistantItem {
  const a = applyChatEvent({ ...pendingAssistant(), key: "live" }, "retrieval", { query: "the last question", hits: [{ n: 1, title: "Guest Wi-Fi", snippet: "EU-Guest" }] });
  return applyChatEvent(a, "text_delta", { delta: "Visitors use EU-Guest [1]. " });
}
const token = (a: AssistantItem, delta: string) => applyChatEvent(a, "text_delta", { delta });

const history = [...finished(1), ...finished(2), ...finished(3)];
const question: ChatItem = { role: "user", key: "u4", text: "And for my visitor?" };
const earlier = () => ["a1", "a2", "a3"].map((k) => renders.get(k));

describe("the thread while an answer streams", () => {
  it("renders the streaming answer for each token, and no earlier answer", async () => {
    let push = (_: string) => {};
    function Thread() {
      const [last, setLast] = useState(live);
      push = (delta) => setLast((a) => token(a, delta));
      // New handlers on every render, as the chat page and the draft test pass them.
      return (
        <ChatMessages
          items={[...history, question, last]}
          agent={agent}
          feedback
          onPatch={patch}
          onAddToEvaluations={() => {}}
          added={() => false}
          onRetry={() => {}}
          onStarter={() => {}}
        />
      );
    }
    renderBare(<Thread />);
    expect(await screen.findByText(/Visitors use EU-Guest/)).toBeInTheDocument();
    const before = earlier();
    const liveBefore = renders.get("live")!;
    expect(before).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    for (const word of ["It ", "is ", "open ", "to ", "anyone."]) act(() => push(word));
    expect(await screen.findByText(/open to anyone\./)).toBeInTheDocument();
    expect(renders.get("live")).toBeGreaterThan(liveBefore);
    expect(earlier()).toEqual(before);
  });

  it("keeps a citation chip mounted from one token to the next", async () => {
    let push = (_: string) => {};
    function Thread() {
      const [last, setLast] = useState(live);
      push = (delta) => setLast((a) => token(a, delta));
      return <ChatMessages items={[question, last]} agent={agent} />;
    }
    renderBare(<Thread />);
    const chip = await screen.findByRole("button", { name: /Source 1/ });
    for (const word of ["It ", "is ", "open."]) act(() => push(word));
    expect(await screen.findByText(/It is open\./)).toBeInTheDocument();
    expect(chip).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Source 1/ })).toBe(chip);
  });
});

const agent = { name: "Helper" };
const patch = () => {};

describe("the composer", () => {
  it("keeps what is typed to itself: no answer is rendered again", async () => {
    const chat = {
      items: history,
      streaming: false,
      error: null,
      setError: () => {},
      announcement: "",
      send: async () => true,
      stop: () => {},
      reset: () => {},
      patch,
      adopt: () => {},
    } satisfies ReturnType<typeof useChat>;
    renderBare(<ChatPanel chat={chat} agent={agent} feedback />);
    const box = await screen.findByRole("textbox", { name: "Message Helper" });
    expect(await findParagraph(/Answer 3/)).toBeInTheDocument();
    const before = earlier();
    await userEvent.type(box, "Where is the library?");
    expect(box).toHaveValue("Where is the library?");
    expect(screen.getByText("21 / 8,000")).toBeInTheDocument();
    expect(earlier()).toEqual(before);
  });
});
