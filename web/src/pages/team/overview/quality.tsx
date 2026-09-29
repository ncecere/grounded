/*
 * The team Overview's "Quality & spend" row (I3, docs/v0.2.1.md): "how are we
 * doing?" at a glance. Evaluation scores: up to five sets with their latest
 * score and the trend against the run before, regressions first, linking to
 * each set and to the team's Evaluations page (editors and above, while
 * evaluations are on). Spend this month: the Usage & spend tab's strip with
 * the budget meter (owners and admins, while cost tracking is on). Members
 * see neither; the row is left out when neither shows.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import type { Schemas } from "@/api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { CellText } from "@/components/ui/data-table/data-table";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { monthLabel } from "@/lib/costs";
import s from "../../shared.module.css";
import { plural, useTeam } from "../common";
import { evalSetsQuery, useEvaluationsOn } from "../evaluations/queries";
import { LastScore, TrendValue } from "../evaluations/score";
import { overviewSets, regressed } from "../evaluations/trend";
import { SpendStrip, useTeamSpend } from "../spend";
import o from "./overview.module.css";

export function QualityAndSpend() {
  const { slug, canEdit, isManager } = useTeam();
  const evaluationsOn = useEvaluationsOn();
  const spend = useTeamSpend(slug, isManager);
  const quality = canEdit && evaluationsOn;
  const money = isManager && spend.data;
  if (!quality && !money) return null;
  return (
    <section aria-label="Quality & spend" className={o.quality}>
      {quality && <EvaluationScores />}
      {money && <SpendThisMonth spend={money} />}
    </section>
  );
}

function EvaluationScores() {
  const { slug } = useTeam();
  const sets = useQuery(evalSetsQuery(slug));
  const list = sets.data ?? [];
  const drops = list.filter(regressed).length;
  const all = list.length > 0 && (
    <TextLink render={<Link to="/teams/$team/evaluations" params={{ team: slug }} />}>{list.length > 5 ? `All ${list.length} evaluations` : "All evaluations"}</TextLink>
  );
  return (
    <Card title="Evaluation scores" description="Each set's latest score, and the change since the run before." actions={all}>
      {sets.isLoading ? (
        <Loading label="Loading evaluation sets…" />
      ) : sets.error ? (
        <ErrorAlert error={sets.error} title="Couldn't load evaluation sets" />
      ) : list.length === 0 ? (
        <EmptyState
          size="compact"
          icon={<ClipboardCheck />}
          title="No evaluation sets yet."
          description={
            <>
              Test answers with the questions people ask.{" "}
              <TextLink render={<Link to="/teams/$team/kbs" params={{ team: slug }} />}>Create a set from a knowledge base</TextLink>.
            </>
          }
        />
      ) : (
        <div className={o.qualityBody}>
          {drops > 0 && <Alert tone="warning">{drops === 1 ? "1 set scored" : `${plural(drops, "set")} scored`} lower than the run before.</Alert>}
          <Table caption="Latest evaluation scores" columns={["Set", "Score", "Trend"]} density="compact">
            {overviewSets(list).map((x) => (
              <Tr key={x.id}>
                <Td>
                  <CellText
                    primary={
                      <TextLink render={<Link to="/teams/$team/evaluations/$setId" params={{ team: slug, setId: x.id }} />} className={s.primary}>
                        {x.name}
                      </TextLink>
                    }
                    secondary={x.target.name}
                  />
                </Td>
                <Td nowrap>
                  <LastScore set={x} />
                </Td>
                <Td nowrap>
                  <TrendValue set={x} />
                </Td>
              </Tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}

function SpendThisMonth({ spend }: { spend: Schemas["TeamSpend"] }) {
  const { slug } = useTeam();
  return (
    <Card
      title="Spend this month"
      description={`${monthLabel(spend.status.month)}. Platform admins set prices and budgets.`}
      actions={<TextLink render={<Link to="/teams/$team/settings" params={{ team: slug }} search={{ tab: "usage" }} />}>Spend breakdown</TextLink>}
    >
      <SpendStrip status={spend.status} />
    </Card>
  );
}
