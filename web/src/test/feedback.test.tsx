/*
 * The answer's feedback buttons (pages/chat/notes.tsx), shared by the
 * signed-in chat and the public page and widget (their own `send`): the
 * share tick saves at once on a rated answer (mem-4), has a visible box
 * while unticked (aud-7), and focus stays on the Bad answer button after a
 * reason is chosen (aud-4).
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "vitest-axe";
import { Feedback, type FeedbackBody, type SendFeedback } from "../pages/chat/notes";
import { type AssistantItem, pendingAssistant } from "../pages/chat/stream";
import { renderBare } from "./harness";

function Harness({ send, initial }: { send: SendFeedback; initial?: AssistantItem["feedback"] }) {
  const [item, setItem] = useState<AssistantItem>({ ...pendingAssistant(), id: "m1", text: "Answer.", status: "done", feedback: initial });
  return <Feedback item={item} send={send} onChange={(f) => setItem((x) => ({ ...x, feedback: f }))} />;
}

function recorder() {
  const bodies: FeedbackBody[] = [];
  const send: SendFeedback = async (_id, body) => {
    bodies.push(body);
    await new Promise((r) => setTimeout(r, 20));
    return { rating: body.rating, reason: body.reason, shared: body.rating === "down" && body.share === true };
  };
  return { bodies, send };
}

describe("feedback", () => {
  it("saves unticking Share on a rated answer at once, through the given sender", async () => {
    const { bodies, send } = recorder();
    const { container } = renderBare(<Harness send={send} initial={{ rating: "down", reason: "outdated", shared: true }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Bad answer: Outdated" }));
    const share = await screen.findByRole("menuitemcheckbox", { name: "Share this question with the team" });
    expect(share).toHaveAttribute("aria-checked", "true");
    await userEvent.click(share);
    await waitFor(() => expect(bodies).toEqual([{ rating: "down", reason: "outdated", share: false }]));
    expect(await screen.findByRole("button", { name: "Bad answer: Outdated" })).toHaveAttribute("aria-pressed", "true");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows the share box unticked, and doesn't send the tick alone before a rating", async () => {
    const { bodies, send } = recorder();
    renderBare(<Harness send={send} />);
    await userEvent.click(await screen.findByRole("button", { name: "Bad answer" }));
    const share = await screen.findByRole("menuitemcheckbox", { name: "Share this question with the team" });
    expect(share).toHaveAttribute("aria-checked", "false");
    // The indicator column carries the box (a class of the app's, aud-7).
    expect(share.className).toMatch(/shareItem/);
    await userEvent.click(share);
    expect(share).toHaveAttribute("aria-checked", "true");
    expect(bodies).toEqual([]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Missing sources" }));
    await waitFor(() => expect(bodies).toEqual([{ rating: "down", reason: "missing_sources", share: true }]));
  });

  it("keeps focus on Bad answer after a reason is chosen with the keyboard", async () => {
    const { bodies, send } = recorder();
    renderBare(<Harness send={send} />);
    (await screen.findByRole("button", { name: "Bad answer" })).focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("menuitemcheckbox", { name: "Share this question with the team" });
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => expect(bodies).toHaveLength(1));
    // While saving (the sender takes 20 ms), the button stays enabled, or a browser drops its focus to the page.
    const busy = screen.getByRole("button", { name: /^Bad answer/ });
    expect(busy).not.toBeDisabled();
    expect(document.activeElement).toBe(busy);
    const button = await screen.findByRole("button", { name: /^Bad answer: / });
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(button).not.toBeDisabled();
  });
});
