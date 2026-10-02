/* Friendly text for chat errors: a title and a message in plain language, by error code. */

/** A title and message for chat errors, in plain language. */
export function chatErrorText(code: string, message = "", retryAfter?: number): { title: string; message: string } {
  switch (code) {
    case "agent_disabled":
    case "agent_disabled_by_platform":
      return { title: "This agent is turned off", message: message || "The team that owns it has disabled it. Try again later." };
    case "agent_policy_violation":
      return {
        title: "This agent can't answer right now",
        message: `Its settings no longer meet the data classification policy, so it was stopped before answering. Ask the team that owns it to review the agent. ${message}`.trim(),
      };
    case "model_unavailable":
      return { title: "The AI model is unavailable", message: "The agent's chat model didn't respond. Try again in a few minutes." };
    case "model_busy":
      return { title: "The AI model is busy", message: "Lots of people are asking questions right now. Try again in a moment." };
    case "rate_limited":
      return {
        title: "Too many questions at once",
        message: `${message || "You've sent a lot of questions in a short time."}${retryAfter ? ` Try again in ${retryAfter} s.` : ""}`,
      };
    case "budget_exhausted":
      return {
        title: "The team's monthly budget is used up",
        message: message || "Chat is paused until the budget resets at the start of next month, or a platform admin raises it.",
      };
    case "agent_unavailable":
      return { title: "This assistant is unavailable right now", message: message || "Please try again later." };
    case "quota_exceeded":
      return { title: "Daily limit reached", message: message || "The team's daily chat budget is used up. It resets at midnight UTC." };
    case "incomplete_answer":
      return { title: "The answer is incomplete", message: "The agent ran out of search steps before it could finish. Try asking a narrower question." };
    case "agent_invalid":
      return { title: "The draft can't be tested yet", message: message || "Fix the problems below first." };
    case "not_found":
    case "agent_not_found":
      return { title: "Agent not found", message: "It may have been deleted, or you don't have access to it." };
    case "network_error":
      return { title: "Connection lost", message: message || "Check your connection and try again." };
    case "send_failed":
      return { title: "Couldn't send your question", message: "Check your connection, then try again. Your question is still in the message box." };
    case "public_disabled":
      return { title: "Public chat is turned off", message: "This assistant isn't available to visitors right now. Try again later." };
    case "limits_unavailable":
      return { title: "The assistant can't take questions right now", message: "Try again in a moment." };
    case "session_expired":
    case "session_required":
      return { title: "Your chat session ended", message: "Send your question again to start a new chat." };
    case "message_too_long":
      return { title: "Your message is too long", message: message || "Shorten it and try again." };
    case "captcha_failed":
      return { title: "Verification failed", message: "Complete the verification again, then send your question." };
    case "invalid_publishable_key":
    case "origin_not_allowed":
      return { title: "This chat isn't set up for this site", message: message || "Ask the site's owner to check the widget settings." };
    default:
      return { title: "Something went wrong", message: message || "The answer couldn't be completed. Try again." };
  }
}
