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
import { Switch } from "@/components/ui/switch/switch";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { cleanOverride, fullRules, moderationCategories, overrideCount, parseThreshold, supportCategories, type ModerationCategory, type ModerationRule } from "@/lib/moderation";
import s from "../../shared.module.css";
import cf from "./build.module.css";
import { type SectionProps, useReportInvalid } from "./section";

type Stage = "input" | "output";

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
      <Switch
        label="Check answers before showing them"
        description="Buffer answers: people see what the agent is doing until the answer passes the check, instead of a streamed answer that may be retracted."
        checked={override.outputMode === "buffer"}
        onCheckedChange={(v) => set({ moderation: { ...override, outputMode: v ? "buffer" : "" } })}
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
