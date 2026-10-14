/* What a chat model's Test says about "How to turn thinking off" (issue #7): some models ignore every switch. */
import type { Schemas } from "@/api/client";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Time } from "@/components/ui/time/time";
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

type Check = Schemas["ThinkingOffCheck"];

/** What the model's last Test found, kept on the model (#52): Works, or Ignored (a warning), with when. */
export function ThinkingOffFact({ check }: { check: Check }) {
  return (
    <span className={s.badges}>
      <Badge tone={check.result === "ignored" ? "warning" : "success"}>{check.result === "ignored" ? "Ignored" : "Works"}</Badge>
      <span className={s.muted}>
        in the Test on <Time value={check.checkedAt} format="date" />
      </span>
    </span>
  );
}
