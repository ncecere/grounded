/*
 * The budget banner on every team page (E2, docs/costs.md §5): shown to
 * everyone in the team when its enforced monthly budget reaches the warning
 * threshold or is used up, so members know why chat stopped. Only owners and
 * admins get the amounts (the API leaves them out for others).
 */
import { Link } from "@tanstack/react-router";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { dayLabel } from "@/components/analytics/format";
import { useBudgetStatus } from "@/lib/costs";
import { formatMoney } from "@/lib/format";
import t from "./team.module.css";

export function BudgetBanner({ team, manager }: { team: string; manager: boolean }) {
  const q = useBudgetStatus(team);
  const b = q.data;
  if (!b || (b.state !== "warning" && b.state !== "exhausted")) return null;
  const resets = b.resetsAt ? dayLabel(b.resetsAt.slice(0, 10)) : "the start of next month";
  const amounts = b.amounts ? ` ${formatMoney(b.amounts.spent, b.amounts.currency)} of ${formatMoney(b.amounts.limit, b.amounts.currency)} spent.` : "";
  const actions = manager && (
    <Button size="sm" variant="secondary" render={<Link to="/teams/$team/settings" params={{ team }} search={{ tab: "usage" }} />}>
      See spend
    </Button>
  );
  return (
    <div className={t.notices}>
      {b.state === "exhausted" ? (
        <Alert tone="warning" title="This team's monthly budget is used up" actions={actions}>
          Chats, searches and ingestion are paused until {resets}, or until a platform admin raises the budget or grants an extension. Nothing is deleted.{amounts}
        </Alert>
      ) : (
        <Alert tone="warning" title="This team is near its monthly budget" actions={actions}>
          When it's used up, chats, searches and ingestion pause until {resets} or a platform admin raises the budget.{amounts}
        </Alert>
      )}
    </div>
  );
}
