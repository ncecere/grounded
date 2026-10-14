/* What a chat model's Test says about "How to turn thinking off" (issue #7): some models ignore every switch. */
import { Alert } from "@/components/ui/alert/alert";
import type { Schemas } from "@/api/client";
import s from "../../shared.module.css";

type ThinkingOffTest = Schemas["ThinkingOffModelTest"];

/** Works: one quiet line. Not honoured: a warning that says what it means for Reasoning effort Off and for the quick calls. Not checked: a quiet line, not a verdict. */
export function ThinkingOffNote({ test }: { test: ThinkingOffTest }) {
  if (test.error != null) return <p className={s.muted}>{test.message}</p>;
  if (test.honoured) return <p className={s.muted}>{test.message}</p>;
  return (
    <Alert tone="warning" title={test.message}>
      {test.reasoningTokens != null && `It used ${test.reasoningTokens.toLocaleString()} reasoning tokens. `}
      An agent's Reasoning effort Off does nothing with this model, so quick calls such as follow-up suggestions and query rewrites stay slow and
      suggestions can run out of tokens before they are written. Use a model whose thinking can be switched off (for example through Extra request
      fields), or clear How to turn thinking off so agents don't offer an Off that does nothing.
    </Alert>
  );
}
