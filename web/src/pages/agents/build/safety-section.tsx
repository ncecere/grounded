/*
 * Build → Safety: the agent's moderation override, stricter-only rules on
 * top of the audience's platform policy (docs/phase4-publishing.md §4). When
 * that policy has no provider nothing checks the rules: the API warns
 * (draft.moderation) and the section says so, with a link for admins (F-18).
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useCurrentUser } from "../../../session";
import { ModerationRuleFields, type RuleForm } from "@/components/moderation-rule";
import { Alert } from "@/components/ui/alert/alert";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { cleanOverride, fullRules, moderationCategories, overrideCount, parseThreshold, supportCategories, type ModerationCategory, type ModerationRule } from "@/lib/moderation";
import s from "../../shared.module.css";
import cf from "./build.module.css";
import { type SectionProps, useReportInvalid } from "./section";

type Stage = "input" | "output";

/** How the agent's answers are checked: the platform's mode, or a stricter one (stream_checked, then buffer). */
const modeOptions = [
  { value: "platform" as const, label: "As the platform's policy says", description: "Answers are checked as the audience's moderation policy sets." },
  {
    value: "stream_checked" as const,
    label: "Paragraph by paragraph",
    description: "Each paragraph is checked with everything before it, then shown, so the answer appears as it's written.",
  },
  { value: "buffer" as const, label: "The whole answer", description: "People see what the agent is doing until the whole answer passes, then all of it at once." },
];

const pct = (r: ModerationRule) => String(Math.round(r.threshold * 100));

export function SafetySection({ c, set, errorFor, warningFor }: SectionProps) {
  const me = useCurrentUser();
  const noProvider = warningFor?.("moderation");
  const override = cleanOverride(c.moderation);
  const count = overrideCount(c.moderation);
  const [open, setOpen] = useState(count > 0);
  /** Thresholds as typed (kept while a value is not a valid percentage yet). */
  const [typed, setTyped] = useState<Record<string, string>>({});
  const rules = fullRules(override.categories);
  const anyInvalid = Object.values(typed).some((t) => parseThreshold(t) === undefined);
  useReportInvalid("agent-field-moderation", anyInvalid);

  const change = (cat: ModerationCategory, stage: Stage, f: RuleForm) => {
    const key = `${cat}.${stage}`;
    setTyped((t) => ({ ...t, [key]: f.threshold }));
    const threshold = parseThreshold(f.threshold) ?? rules[cat][stage].threshold;
    const next = { ...rules[cat], [stage]: { action: f.action, threshold } };
    set({ moderation: cleanOverride({ ...override, categories: { ...override.categories, [cat]: next } }) });
  };

  return (
    <div id="agent-field-moderation" className={cf.moderation}>
      <p className={s.settingDescription}>
        The platform moderates this agent's audience under its own policy. Rules here can only make it stricter: they combine with the platform's, taking the stronger action and
        the lower threshold.
      </p>
      {errorFor("moderation") && <p className={s.dangerText}>{errorFor("moderation")}</p>}
      {noProvider && !errorFor("moderation") && (
        <Alert tone="warning" title="These rules have no effect yet">
          {noProvider}{" "}
          {me.capabilities.platformAdmin && (
            <TextLink render={<Link to="/admin/moderation" search={{ tab: c.audience === "team" ? undefined : c.audience }} />}>Open Admin → Moderation</TextLink>
          )}
        </Alert>
      )}
      <RadioGroup
        legend="Check answers before showing them"
        description="Stricter only: a mode the platform's policy already exceeds changes nothing."
        value={override.outputMode || "platform"}
        onValueChange={(v) => set({ moderation: { ...override, outputMode: v === "platform" ? "" : v } })}
        options={modeOptions}
      />
      <Disclosure
        title="Stricter category rules"
        summary={count === 0 ? "Platform policy only" : count === 1 ? "1 category tightened" : `${count} categories tightened`}
        open={open}
        onOpenChange={setOpen}
      >
        <Table caption="Stricter category rules" columns={["Category", "Questions", "Answers"]}>
          {moderationCategories.map((cat) => (
            <Tr key={cat.value}>
              <Td>{cat.label}</Td>
              {(["input", "output"] as const).map((stage) => {
                const r = rules[cat.value][stage];
                const key = `${cat.value}.${stage}`;
                return (
                  <Td key={stage}>
                    <ModerationRuleFields
                      label={`${cat.label}, ${stage === "input" ? "questions" : "answers"}`}
                      offLabel="Platform"
                      allowSupport={supportCategories.includes(cat.value)}
                      rule={{ action: r.action, threshold: typed[key] ?? pct(r) }}
                      invalid={typed[key] !== undefined && parseThreshold(typed[key]!) === undefined}
                      onChange={(f) => change(cat.value, stage, f)}
                    />
                  </Td>
                );
              })}
            </Tr>
          ))}
        </Table>
      </Disclosure>
    </div>
  );
}
