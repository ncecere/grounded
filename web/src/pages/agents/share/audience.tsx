/*
 * Share → Audience (W8, docs/phase4-publishing.md §3): who can chat with the
 * agent once published. Part of the draft, so it takes effect with the next
 * version. An option the viewer can't publish to is disabled, with why (m03),
 * except the selected one and the live one: an editor who narrows a shared
 * agent's draft can always go back to what's live.
 */
import { Alert } from "@/components/ui/alert/alert";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { audienceLabel } from "@/lib/terms";
import type { AgentDraft } from "../draft";
import { type Audience, type Sharing, audienceLabels } from "./sharing";
import sh from "./share.module.css";

/** "Only team admins…" after a colon reads "only team admins…"; a name or acronym keeps its capital. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function AudienceSection({ d, sharing, published }: { d: AgentDraft; sharing: Sharing; published: boolean }) {
  const value = d.draft.config.audience;
  const problem = d.problems.find((p) => p.field.replace(/^draft\./, "") === "audience")?.problem;
  return (
    <div id="agent-field-audience" className={sh.audience}>
      {published && value !== sharing.audience && (
        <Alert tone="info">
          People chat with the live version as {audienceLabel(sharing.audience)}. Publish to change it to {audienceLabel(value)}.
        </Alert>
      )}
      <RadioGroup
        legend="Who can chat"
        variant="card"
        value={value}
        onValueChange={(v: Audience) => d.setConfig({ audience: v })}
        error={problem}
        options={(Object.keys(audienceLabels) as Audience[]).map((a) => {
          const o = sharing.options.find((x) => x.audience === a);
          const blocked = Boolean(o && !o.allowed);
          const live = published && a === sharing.audience;
          const kept = value === a || live;
          return {
            value: a,
            label: audienceLabels[a].label,
            disabled: blocked && !kept,
            description: (
              <>
                {audienceLabels[a].description}
                {blocked && (
                  <span className={sh.whyNot}>
                    {" "}
                    {/* A sentence after the colon starts in lower case (BU2-11). */}
                    {kept ? `${live ? "The live version uses it. " : ""}You can't publish to it: ` : "Not available: "}
                    {lowerFirst(o!.reasons.join(". "))}.
                  </span>
                )}
              </>
            ),
          };
        })}
      />
    </div>
  );
}
