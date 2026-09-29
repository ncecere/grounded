import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { claimLabel, claimSummaryText } from "../pages/chat/claims";
import { type AssistantItem, type ChatItem, applyChatEvent, itemsFromConversation, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { renderBare } from "./harness";

/* Per-claim verification (docs/systemone.md §3, v0.2.1 I9): chips show their claim's verdict, the card the claim, the summary counts claims. */

type Claim = Schemas["Claim"];

const cite = (n: number, extra: Partial<Schemas["Citation"]> = {}): Schemas["Citation"] => ({
  n, documentId: `d${n}`, sourceId: "s", title: `Page ${n}`, snippet: `Passage ${n} about transcripts.`, headingPath: [], ...extra,
});

// "Transcripts cost $10 [1][2]. Rush orders arrive the same day [2]. Log in first with your account."
const text = "Transcripts cost $10 [1][2]. Rush orders arrive the same day [2]. Log in first with your account.";
const claims: Claim[] = [
  {
    index: 0, start: 0, end: 28, text: "Transcripts cost $10.", verdict: "supported", sources: [1], confidence: 0.97,
    checks: [{ n: 1, occurrence: 0, verification: "verified", confidence: 0.97 }, { n: 2, occurrence: 0, verification: "unsupported", confidence: 0.9 }],
  },
  {
    index: 1, start: 29, end: 65, text: "Rush orders arrive the same day.", verdict: "not_supported", sources: [], confidence: 0.92,
    checks: [{ n: 2, occurrence: 1, verification: "contradicted", confidence: 0.92 }],
  },
  { index: 2, start: 66, end: 97, text: "Log in first with your account.", verdict: "uncited", sources: [] },
];

/** An answer as the stream leaves it after citations_checked with claims. */
function checkedAnswer(withClaims: Claim[] | undefined, citations = [cite(1), cite(2)], uncited?: Schemas["UncitedSentence"][]): AssistantItem {
  let a = applyChatEvent(pendingAssistant(), "message_end", { messageId: "m1", stopReason: "stop", text, citations: [cite(1), cite(2)], refused: false, noContext: false });
  a = applyChatEvent(a, "citations_checked", { messageId: "m1", text, citations, uncited, claims: withClaims, refused: false, verified: 2, unsupported: 2, unchecked: 0 });
  return applyChatEvent(a, "done", {});
}
const thread = (a: AssistantItem): ChatItem[] => [{ role: "user", key: "u1", text: "How do I order a transcript?" }, a];

describe("claims", () => {
  it("summarises claims: supported of scored, uncited and unchecked apart", () => {
    expect(claimSummaryText(claims)).toBe("1 of 3 claims supported · 1 uncited");
    expect(claimSummaryText([...claims, { index: 3, start: 0, end: 1, text: "x", verdict: "unchecked", sources: [] }])).toBe(
      "1 of 3 claims supported · 1 uncited · 1 not checked",
    );
    expect(claimSummaryText([claims[0]!])).toBe("1 of 1 claim supported");
    expect(claimSummaryText([])).toBe("");
  });

  it("explains a claim's verdict for each of its sources", () => {
    expect(claimLabel(claims[0]!, 1)).toBe("Claim supported by this source (97% confidence)");
    expect(claimLabel(claims[0]!, 2)).toBe("Claim supported by source 1; not by this source");
    expect(claimLabel(claims[1]!, 2)).toBe("Claim not supported: this source contradicts it (92% confidence)");
    expect(claimLabel(claims[2]!, 1)).toBeUndefined();
  });

  it("gives each chip its claim's verdict, shows the summary and marks the uncited claim", async () => {
    const { container } = renderBare(<ChatMessages items={thread(checkedAnswer(claims))} agent={{ name: "Helper" }} />);
    const one = await screen.findByRole("button", { name: /^Source 1: Page 1/ });
    const twos = screen.getAllByRole("button", { name: /^Source 2: Page 2/ });
    // [2] in the first sentence doesn't support it, but [1] does: the claim, and so the chip, is supported.
    expect(one).toHaveAttribute("data-verification", "verified");
    expect(twos.map((c) => c.getAttribute("data-verification"))).toEqual(["verified", "contradicted"]);
    expect(twos[0]).toHaveAccessibleName("Source 2: Page 2. Claim supported by source 1; not by this source");
    expect(twos[1]).toHaveAccessibleName("Source 2: Page 2. Claim not supported: this source contradicts it (92% confidence)");
    expect(screen.getByTestId("claim-summary")).toHaveTextContent("1 of 3 claims supported · 1 uncited");
    const mark = screen.getByText("Uncited");
    expect(mark.closest("p")).toHaveTextContent(/Log in first with your account\. Uncited/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows the claim, its verdict and the passage in the chip's card", async () => {
    const { container } = renderBare(<ChatMessages items={thread(checkedAnswer(claims))} agent={{ name: "Helper" }} />);
    const twos = await screen.findAllByRole("button", { name: /^Source 2: Page 2/ });
    await userEvent.hover(twos[1]!);
    const card = await screen.findByRole("dialog", {}, { timeout: 2000 });
    expect(within(card).getByText("Claim not supported: this source contradicts it (92% confidence)")).toBeInTheDocument();
    expect(within(card).getByText("Rush orders arrive the same day.")).toBeInTheDocument();
    expect(within(card).getByText("Claim:", { exact: false })).toBeInTheDocument();
    expect(within(card).getByText("Passage 2 about transcripts.")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.unhover(twos[1]!);
  });

  it("shows a message stored before claims as v0.2.0 did: per-marker verdicts, Uncited marks, no summary", async () => {
    // A v0.2.0 conversation message: citations with markers and uncited offsets, no claims.
    const stored: Schemas["ConversationMessage"][] = [
      { id: "u1", seq: 1, role: "user", text: "How do I order a transcript?", createdAt: "2026-09-20T10:00:00Z" },
      {
        id: "m1", seq: 2, role: "assistant", text, createdAt: "2026-09-20T10:00:01Z", stopReason: "stop",
        citations: [
          cite(1, { verification: "verified", confidence: 0.97, markers: [{ verification: "verified", confidence: 0.97 }] }),
          cite(2, { verification: "contradicted", confidence: 0.92, markers: [{ verification: "unsupported", confidence: 0.9 }, { verification: "contradicted", confidence: 0.92 }] }),
        ],
        uncited: [{ start: 66, end: 97 }],
      },
    ];
    const items = itemsFromConversation(stored);
    expect((items[1] as AssistantItem).claims).toBeUndefined();
    const { container } = renderBare(<ChatMessages items={items} agent={{ name: "Helper" }} />);
    const twos = await screen.findAllByRole("button", { name: /^Source 2: Page 2/ });
    expect(twos.map((c) => c.getAttribute("data-verification"))).toEqual(["unsupported", "contradicted"]);
    expect(twos[0]).toHaveAccessibleName("Source 2: Page 2. Not supported by this source (90% confidence)");
    expect(screen.getByText("Uncited")).toBeInTheDocument();
    expect(screen.queryByTestId("claim-summary")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("leaves the summary out for an answer without sources", async () => {
    const a = { ...checkedAnswer([claims[2]!], []), noContext: true };
    renderBare(<ChatMessages items={thread(a)} agent={{ name: "Helper" }} />);
    await screen.findByText(/Log in first/);
    expect(screen.queryByTestId("claim-summary")).toBeNull();
    expect(screen.queryByText("Uncited")).toBeNull();
  });
});

describe("the sources under an answer", () => {
  it("start collapsed; a citation chip opens them and focuses its source", async () => {
    const { container } = renderBare(<ChatMessages items={thread(checkedAnswer(claims))} agent={{ name: "Helper" }} />);
    const trigger = await screen.findByRole("button", { name: "Used 2 sources" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Sources for this answer" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Source 1: Page 1/ }));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const card = await screen.findByRole("listitem", { name: "Source 1: Page 1" });
    await waitFor(() => expect(card).toHaveFocus());
    expect(await axe(container)).toHaveNoViolations();
  });
});
