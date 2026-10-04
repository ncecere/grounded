/*
 * A model's compatibility settings, read-only on its record page (AD-09): what Grounded sends to this server and how,
 * so platform auditors (who have no Edit) and admins see them without opening the form. Each value says what the
 * default means, as the form's options do.
 */
import type { ReactNode } from "react";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import s from "../../shared.module.css";
import type { Model } from "./common";

const yesNo = (v: boolean | undefined, dflt: string, yes = "Yes, sent", no = "No") => (v === undefined ? dflt : v ? yes : no);

const thinkingOffLabels: Record<string, string> = {
  reasoning_effort_none: 'reasoning_effort: "none"',
  enable_thinking_false: 'chat_template_kwargs: {"enable_thinking": false}',
};

/** Uses the chat completions compatibility flags (chat, vision, chat-classifier moderation). */
const usesChat = (m: Model) => m.kind === "chat" || m.kind === "vision" || (m.kind === "moderation" && m.moderationProvider === "chat_classifier");

/** The facts for a model's kind; empty when its kind has no compatibility settings. */
export function compatFacts(m: Model): { label: string; value: ReactNode }[] {
  const c = m.compat ?? {};
  if (m.kind === "embedding") return [{ label: "Dimensions parameter", value: c.supportsDimensionsParam ? "Sent (the server shortens vectors)" : "Not sent (Grounded shortens vectors)" }];
  if (m.kind === "rerank") {
    return [
      { label: "Passages field", value: c.rerankDocumentsField ?? "Default (documents)" },
      { label: "Accepts top_n", value: yesNo(c.supportsRerankTopN, "Default (sent)") },
    ];
  }
  if (!usesChat(m)) return [];
  const facts = [
    ...(m.kind === "chat" ? [{ label: "Tool calling", value: m.supportsTools ? "Supported" : "Not supported" }, { label: "Images", value: m.supportsVision ? "Supported" : "Not supported" }] : []),
    { label: "Output limit parameter", value: c.maxTokensField ?? "Default (max_tokens)" },
    { label: "System prompt role", value: c.supportsDeveloperRole === undefined ? "Default (system)" : c.supportsDeveloperRole ? "developer" : "system" },
    { label: "Honours tool_choice", value: yesNo(c.supportsToolChoice, "Default (not sent)") },
    { label: "Accepts reasoning effort", value: yesNo(c.supportsReasoningEffort, "Default (not sent)") },
    ...(m.kind === "chat" ? [{ label: "How to turn thinking off", value: c.thinkingOff ? thinkingOffLabels[c.thinkingOff] : "Not supported (default)" }] : []),
    {
      label: "Extra request fields",
      value: c.extraBody && Object.keys(c.extraBody).length ? <code className={s.mono}>{JSON.stringify(c.extraBody)}</code> : "None",
    },
  ];
  return facts;
}

export function CompatSection({ model }: { model: Model }) {
  return <DescriptionList items={compatFacts(model)} />;
}
