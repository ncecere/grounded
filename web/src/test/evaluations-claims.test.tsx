import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { EvalAnswer } from "../pages/team/evaluations/answer";
import { ResultDetail } from "../pages/team/evaluations/result-detail";
import { result } from "./evaluations-fixtures";
import { renderBare } from "./harness";

/*
 * A full-answer result renders its answer with chat's chips and card (v0.2.1 I9): with claims, each chip shows its
 * claim's verdict and the answer the same summary as in chat, so the result page and chat agree.
 */

const answer = "Official transcripts cost $10 [1]. Rush orders arrive the same day [2]. Pick them up at the front desk.";
const hit = (n: number, title: string, extra: Partial<Schemas["EvaluationHit"]> = {}): Schemas["EvaluationHit"] => ({
  rank: n, n, documentId: `d${n}`, title, expected: n === 1, snippet: `${title} passage.`, ...extra,
});
const claims: Schemas["Claim"][] = [
  { index: 0, start: 0, end: 34, text: "Official transcripts cost $10.", verdict: "supported", sources: [1], confidence: 0.97,
    checks: [{ n: 1, occurrence: 0, verification: "verified", confidence: 0.97 }] },
  { index: 1, start: 35, end: 71, text: "Rush orders arrive the same day.", verdict: "not_supported", sources: [], confidence: 0.95,
    checks: [{ n: 2, occurrence: 0, verification: "unsupported", confidence: 0.95 }] },
  { index: 2, start: 72, end: 103, text: "Pick them up at the front desk.", verdict: "uncited", sources: [] },
];
const scores = { cited: true, refused: false, mentions: [], supportedShare: 1 / 3, uncited: 1, supportedClaims: 1, claimsScored: 3 };

describe("an evaluation result's answer", () => {
  it("shows claim verdicts on its chips, the claims summary and the Uncited mark, as chat does", async () => {
    const r = result("res1", "What does a transcript cost?", "pass", { answer, hits: [hit(1, "Fees"), hit(2, "Rush")], claims, scores });
    const { container } = renderBare(<EvalAnswer result={r} />);
    const one = await screen.findByRole("button", { name: /^Source 1: Fees/ });
    expect(one).toHaveAttribute("data-verification", "verified");
    expect(one).toHaveAccessibleName("Source 1: Fees. Claim supported by this source (97% confidence)");
    expect(screen.getByRole("button", { name: /^Source 2: Rush/ })).toHaveAttribute("data-verification", "unsupported");
    expect(screen.getByTestId("claim-summary")).toHaveTextContent("1 of 3 claims supported · 1 uncited");
    expect(screen.getByText("Uncited").closest("p")).toHaveTextContent(/front desk\. Uncited/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens a chip's card from the keyboard, with the claim; the card leads to the source", async () => {
    const r = result("res1", "What does a transcript cost?", "pass", { answer, hits: [hit(1, "Fees"), hit(2, "Rush")], claims, scores });
    const { container } = renderBare(<EvalAnswer result={r} />);
    const trigger = await screen.findByRole("button", { name: "Used 2 sources" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const chip = screen.getByRole("button", { name: /^Source 2: Rush/ });
    chip.focus();
    await userEvent.keyboard("{Enter}");
    const card = await screen.findByRole("dialog");
    // Screen readers get the claim as the card's description.
    expect(card).toHaveAccessibleDescription(/Claim:/);
    await waitFor(() => expect(card.contains(document.activeElement)).toBe(true));
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(chip).toHaveFocus();
    await userEvent.keyboard(" ");
    const jump = within(await screen.findByRole("dialog")).getByRole("button", { name: "Show source 2 below" });
    jump.focus();
    await userEvent.keyboard("{Enter}");
    const list = await screen.findByRole("list", { name: "Sources for this answer" });
    await waitFor(() => expect(within(list).getByRole("listitem", { name: "Source 2: Rush" })).toHaveFocus());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renders a result recorded before claims with plain chips and no summary", async () => {
    const r = result("res1", "What does a transcript cost?", "pass", { answer, hits: [hit(1, "Fees"), hit(2, "Rush")], scores: { ...scores, supportedClaims: undefined } });
    renderBare(<EvalAnswer result={r} />);
    const one = await screen.findByRole("button", { name: /^Source 1: Fees/ });
    expect(one).not.toHaveAttribute("data-verification");
    expect(screen.queryByTestId("claim-summary")).toBeNull();
    expect(screen.queryByText("Uncited")).toBeNull();
  });

  it("labels a v0.2.0 result's share as the old count, which counted citations", async () => {
    const old = { cited: true, refused: false, mentions: [], supportedShare: 1 };
    const r = result("res1", "What does a transcript cost?", "pass", { answer, hits: [hit(1, "Fees"), hit(2, "Rush")], scores: old });
    const { container } = renderBare(<ResultDetail result={r} />);
    expect(await screen.findByText("Supported (v0.2.0 count): 100% of citations")).toBeInTheDocument();
    expect(screen.queryByText(/of claims supported/)).toBeNull();
    // Its markers are chips (the API numbers v0.2.0 citations from the markers).
    expect(screen.getByRole("button", { name: /^Source 1: Fees/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
