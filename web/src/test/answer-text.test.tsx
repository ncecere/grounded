import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { citedSoFar, displayText, normalizeMarkers, normalizePunctuation, settlePartial } from "../pages/chat/answer-text";
import { type AssistantItem, type ChatItem, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { findParagraph, renderBare } from "./harness";

/* How an answer's text is shown: model punctuation (M2) and citation markers. */

describe("normalizePunctuation", () => {
  it("replaces non-breaking hyphens and no-break spaces, and drops invisible characters", () => {
    expect(normalizePunctuation("military\u2011benefits@example.edu")).toBe("military-benefits@example.edu");
    expect(normalizePunctuation("555\u2011392\u20114357")).toBe("555-392-4357");
    expect(normalizePunctuation("Jan\u202f1\u202f1975 and\u00a0more\u2009here")).toBe("Jan 1 1975 and more here");
    expect(normalizePunctuation("zero\u200bwidth\u2060joiner\ufeff soft\u00adhyphen")).toBe("zerowidthjoiner softhyphen");
    // Real punctuation stays.
    expect(normalizePunctuation("2\u20133 months \u2014 “quoted”")).toBe("2\u20133 months \u2014 “quoted”");
  });

  it("normalises markers only while streaming", () => {
    expect(displayText("Fee\u202f【1】.", true)).toBe("Fee [1].");
    expect(displayText("Fee\u202f[1].", false)).toBe("Fee [1].");
    expect(normalizeMarkers("online【2】.")).toBe("online [2].");
  });
});

describe("settlePartial (M4)", () => {
  const sources = [
    { n: 1, title: "Fees", snippet: "Ten dollars.", url: "https://registrar.example.edu/fees" },
    { n: 3, title: "Hours", snippet: "Open 9-5." },
  ];
  it("normalises markers, keeps known sources as citations and drops unknown numbers", () => {
    const a = settlePartial({ ...pendingAssistant(), status: "aborted", sources, text: "Ten dollars\u202f\u30101, 3\u3011 [7]; arr[1] and m[i][3] stay; [1][3] twice" });
    expect(a.text).toBe("Ten dollars [1][3]; arr[1] and m[i][3] stay; [1][3] twice");
    expect(a.citations.map((c) => [c.n, c.title, c.url])).toEqual([
      [1, "Fees", "https://registrar.example.edu/fees"],
      [3, "Hours", undefined],
    ]);
  });
  it("keeps citations that already arrived", () => {
    const cited = { n: 1, documentId: "d", sourceId: "s", title: "Fees", snippet: "", headingPath: [] };
    const a = settlePartial({ ...pendingAssistant(), sources, citations: [cited], text: "Fee [1]." });
    expect(a.citations).toEqual([cited]);
  });
});

describe("answers with model punctuation", () => {
  const answer = (text: string, status: AssistantItem["status"]): ChatItem[] => [
    { role: "user", key: "u1", text: "Who do I write to?" },
    { ...pendingAssistant(), key: "a1", text, status },
  ];

  it.each(["streaming", "done"] as const)("links the whole e-mail address and shows plain spaces (%s)", async (status) => {
    const { container } = renderBare(<ChatMessages items={answer("Write to military\u2011benefits@example.edu since Jan\u202f1\u202f1975.", status)} agent={{ name: "Helper" }} />);
    const link = await screen.findByRole("link", { name: /military-benefits@example.edu/ });
    expect(link).toHaveAttribute("href", "mailto:military-benefits@example.edu");
    expect(container.textContent).toContain("since Jan 1 1975.");
    expect(container.textContent).not.toMatch(/[\u2011\u202f]/);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("checked paragraphs before message_end (mem-11)", () => {
  const sources = [
    { n: 1, title: "Fees", snippet: "Ten dollars." },
    { n: 3, title: "Hours", snippet: "Open 9-5." },
  ];
  it("cites the known sources of the markers so far", () => {
    const a = { ...pendingAssistant(), sources, text: "Ten dollars [1]. Open late\u30103\u3011 and [7] and arr[1]." };
    expect(citedSoFar(a).map((c) => c.n)).toEqual([1, 3]);
  });

  it("shows chips, not raw markers, while a checked answer streams", async () => {
    const items: ChatItem[] = [
      { role: "user", key: "u1", text: "How much?" },
      { ...pendingAssistant(), key: "a1", checked: true, sources, text: "It costs ten dollars [1].\n\n" },
    ];
    const { container } = renderBare(<ChatMessages items={items} agent={{ name: "Helper" }} />);
    await findParagraph(/It costs ten dollars/);
    expect(container.textContent).not.toContain("[1]");
    expect(await axe(container)).toHaveNoViolations();
  });
});
