import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { withUncited } from "../pages/chat/citations";
import { type AssistantItem, type ChatItem, applyChatEvent, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { renderBare } from "./harness";

/* How answers read (docs/systemone.md §3, the v0.2 review): a verdict per citation marker, "Uncited" marks, the thinking panel, long messages. */

const cite = (n: number, extra: Partial<Schemas["Citation"]> = {}): Schemas["Citation"] => ({
  n, documentId: `d${n}`, sourceId: "s", title: `Page ${n}`, snippet: `Snippet ${n}`, headingPath: [], ...extra,
});
const checked = (text: string, citations: Schemas["Citation"][], uncited?: Schemas["UncitedSentence"][], extra: Partial<AssistantItem> = {}): AssistantItem => {
  let a = applyChatEvent(pendingAssistant(), "message_end", { messageId: "m1", stopReason: "stop", text, citations: citations.map((c) => cite(c.n)), refused: false, noContext: false });
  a = applyChatEvent(a, "citations_checked", { messageId: "m1", text, citations, uncited, refused: false, verified: 1, unsupported: 1, unchecked: 0 });
  return { ...applyChatEvent(a, "done", {}), ...extra };
};
const thread = (a: AssistantItem): ChatItem[] => [{ role: "user", key: "u1", text: "How do I order a transcript?" }, a];

describe("a verdict per citation marker", () => {
  it("marks each [n] with its own sentence's verdict, not the source's worst", async () => {
    const text = "You need an active account [2]. Orders can't be changed [2]. Mark yourself as the recipient [1][2].";
    const two = cite(2, {
      verification: "unsupported", confidence: 0.96,
      markers: [{ verification: "verified", confidence: 0.97 }, { verification: "verified", confidence: 0.9 }, { verification: "unsupported", confidence: 0.96 }],
    });
    const one = cite(1, { verification: "verified", confidence: 0.99, markers: [{ verification: "verified", confidence: 0.99 }] });
    const { container } = renderBare(<ChatMessages items={thread(checked(text, [one, two]))} agent={{ name: "Helper" }} />);
    const chips = await screen.findAllByRole("button", { name: /^Source 2: Page 2/ });
    expect(chips.map((c) => c.getAttribute("data-verification"))).toEqual(["verified", "verified", "unsupported"]);
    expect(chips[0]).toHaveAccessibleName("Source 2: Page 2. Verified: the source supports this (97% confidence)");
    expect(chips[2]).toHaveAccessibleName("Source 2: Page 2. Not supported by this source (96% confidence)");
    expect(screen.getByRole("button", { name: /^Source 1: Page 1/ })).toHaveAttribute("data-verification", "verified");
    // The source card still says how the source fared overall (the list starts collapsed).
    await userEvent.click(screen.getByRole("button", { name: "Used 2 sources" }));
    expect(within(screen.getByRole("list", { name: "Sources for this answer" })).getByText(/Not supported by this source \(96% confidence\)/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("falls back to the source's verdict for answers checked before per-marker verdicts", async () => {
    renderBare(<ChatMessages items={thread(checked("A fee applies [1]. It is ten dollars [1].", [cite(1, { verification: "unsupported", confidence: 0.9 })]))} agent={{ name: "Helper" }} />);
    const chips = await screen.findAllByRole("button", { name: /^Source 1/ });
    expect(chips.map((c) => c.getAttribute("data-verification"))).toEqual(["unsupported", "unsupported"]);
  });
});

describe("uncited sentences", () => {
  const text = "Transcripts cost $10 [1]. Log in with your campus password first. Orders take ten days [1].";
  const uncited = [{ start: 26, end: 65 }];

  it("puts the sentinel after each uncited sentence, by code points", () => {
    expect(withUncited("Café is open. Fee [1].", [{ start: 0, end: 13 }])).toBe("Café is open. \ue000 Fee [1].");
    expect(withUncited("Ends here.", [{ start: 0, end: 10 }])).toBe("Ends here. \ue000");
    expect(withUncited("No marks.", undefined)).toBe("No marks.");
  });

  it("shows a subtle Uncited mark after a factual sentence without a citation", async () => {
    const one = cite(1, { verification: "verified", confidence: 0.9, markers: [{ verification: "verified" }, { verification: "verified" }] });
    const { container } = renderBare(<ChatMessages items={thread(checked(text, [one], uncited))} agent={{ name: "Helper" }} />);
    const mark = await screen.findByText("Uncited");
    expect(mark).toHaveTextContent("Uncited: no source is cited for this sentence");
    expect(mark.closest("p")).toHaveTextContent(/Log in with your campus password first\. Uncited/);
    expect(screen.getAllByText("Uncited")).toHaveLength(1);
    expect(container.textContent).not.toContain("\ue000");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows nothing for an answer without sources (its note says so already)", async () => {
    renderBare(<ChatMessages items={thread(checked(text, [], uncited, { noContext: true }))} agent={{ name: "Helper" }} />);
    await screen.findByText(/Log in with your campus password/);
    expect(screen.queryByText("Uncited")).toBeNull();
  });
});

describe("the thinking panel", () => {
  const thinkingItem = (): AssistantItem => ({ ...pendingAssistant(), key: "a1", thinking: "The rules say to answer only from sources." });

  it("shows readers only “Thinking…”, never the reasoning", async () => {
    renderBare(<ChatMessages items={thread(thinkingItem())} agent={{ name: "Helper" }} />);
    expect(await screen.findByText("Thinking…")).toBeInTheDocument();
    expect(screen.queryByText(/answer only from sources/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Thinking|Thought/ })).toBeNull();
  });

  it("lets editors testing a draft open it", async () => {
    renderBare(<ChatMessages items={thread(thinkingItem())} agent={{ name: "Helper" }} showThinking />);
    expect(await screen.findByRole("button", { name: /Thinking/ })).toBeInTheDocument();
  });
});

describe("long messages", () => {
  it("collapses a very long question with Show more", async () => {
    const long = `${"I finished my degree years ago and need a transcript for a graduate school application. ".repeat(20)}Thanks.`;
    const { container } = renderBare(<ChatMessages items={[{ role: "user", key: "u1", text: long }]} agent={{ name: "Helper" }} />);
    const more = await screen.findByRole("button", { name: "Show more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("leaves a short question as it is", async () => {
    renderBare(<ChatMessages items={[{ role: "user", key: "u1", text: "How much is a transcript?" }]} agent={{ name: "Helper" }} />);
    await screen.findByText("How much is a transcript?");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
});
