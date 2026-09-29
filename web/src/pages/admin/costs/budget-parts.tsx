/* The budget pieces the Budgets tab, a team's Budget card and the team's Usage & limits share: the meter, the state and the mode. */
import type { Schemas } from "@/api/client";
import { Badge, StatusBadge } from "@/components/ui/badge/badge";
import { Meter } from "@/components/ui/meter/meter";
import { budgetStateLabel, budgetStateTone, modeLabels, modeSourceLabel } from "@/lib/costs";
import { formatMoney } from "@/lib/format";
import c from "./costs.module.css";

/** The budget share as a meter (none without a budget). */
export function BudgetMeter({ status, label }: { status: Schemas["TeamBudgetState"]; label: string }) {
  if (status.limit === null || status.spent === null) return <span>—</span>;
  const limit = Number(status.limit);
  return (
    <Meter
      label={label}
      hideLabel
      size="sm"
      value={Number(status.spent)}
      max={limit}
      warningAt={status.warnPercent / 100}
      valueText={`${status.percent ?? 0}%`}
      formatValue={(v) => formatMoney(String(v), status.currency)}
    />
  );
}

/** The state, and "Not enforced" beside a Track-only budget's (progress only: it never blocks or notifies). */
export function BudgetStateBadge({ status }: { status: Schemas["TeamBudgetState"] }) {
  return (
    <span className={c.stateBadges}>
      <StatusBadge tone={budgetStateTone(status)}>{budgetStateLabel(status)}</StatusBadge>
      {!status.enforced && status.state !== "none" && (
        <Badge size="sm" variant="outline">
          Not enforced
        </Badge>
      )}
    </span>
  );
}

/** A team's mode and where it comes from, in the same words on the Budgets tab and the team's Budget card. */
export function ModeText({ mode, override }: { mode: Schemas["CostMode"]; override: Schemas["CostModeOverride"] }) {
  return (
    <>
      {modeLabels[mode]}{" "}
      <Badge size="sm" variant="outline">
        {modeSourceLabel(override)}
      </Badge>
    </>
  );
}
