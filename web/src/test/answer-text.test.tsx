import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { displayText, normalizeMarkers, normalizePunctuation } from "../pages/chat/answer-text";
import { type AssistantItem, type ChatItem, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { renderBare } from "./harness";

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
