/*
 * Limits in one shape everywhere (D7): the four groups of lib/limits.ts
 * (Team resources · Ingestion · Queries & chat · Public agents). The admin
 * Limits page shows them as pill tabs; a team's limits as this accordion,
 * with an Effective and a Usage column.
 */
import type { ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion/accordion";
import { Meter } from "@/components/ui/meter/meter";
import { type LimitGroup, formatAmount, limitGroups, periodSuffix } from "@/lib/limits";
import s from "../../shared.module.css";
import l from "./limits.module.css";

type Grouped = { group: LimitGroup; key: string };

/** Items of one group, in registry order. */
export const inGroup = <T extends Grouped>(items: T[], g: LimitGroup) => items.filter((it) => it.group === g);

type AccordionProps<T extends Grouped> = {
  items: T[];
  /** The panel of one group, e.g. a table. */
  render: (items: T[], group: (typeof limitGroups)[number]) => ReactNode;
  /** Muted text beside a group's title, e.g. "2 overrides · 1 near limit". */
  meta?: (items: T[]) => ReactNode;
  /** Open groups (default: Team resources). */
  defaultOpen?: LimitGroup[];
};

export function LimitGroupAccordion<T extends Grouped>({ items, render, meta, defaultOpen = ["resources"] }: AccordionProps<T>) {
  return (
    <Accordion multiple defaultValue={defaultOpen} variant="outline" headingLevel={3}>
      {limitGroups.map((g) => {
        const group = inGroup(items, g.key);
        if (group.length === 0) return null;
        return (
          <AccordionItem key={g.key} value={g.key}>
            <AccordionTrigger meta={meta?.(group)}>{g.label}</AccordionTrigger>
            <AccordionPanel>
              <p className={l.groupDescription}>{g.description}</p>
              {render(group, g)}
            </AccordionPanel>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

/** A team's usage of a limit as a meter ("—" when not measured). */
export function UsageCell({ limit, label }: { limit?: Schemas["TeamLimit"]; label: string }) {
  if (!limit || limit.used === null) return <span className={s.muted}>—</span>;
  const max = limit.max === null ? null : limit.max;
  return (
    <Meter
      size="sm"
      hideLabel
      label={`${label}: usage`}
      value={limit.used}
      max={max === 0 ? null : max}
      formatValue={(v) => formatAmount(limit.unit, v)}
      valueText={max === null || max === 0 ? `${formatAmount(limit.unit, limit.used)}${periodSuffix(limit.period)}` : undefined}
      className={l.usage}
    />
  );
}

/** Share of the limit used, or 0 when unlimited or not measured. */
export const usedShare = (it?: Schemas["TeamLimit"]) => (it && it.used !== null && it.max ? it.used / it.max : 0);
