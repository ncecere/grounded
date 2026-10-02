/*
 * Failed questions per team (docs/gaps.md, owner decision 2): platform
 * admins and auditors see counts per team and signal only, never a team's
 * topics or questions (ADR-0010 as amended for v0.4.0).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, unwrap, type Schemas } from "@/api/client";
import { num } from "@/components/analytics/format";
import type { Range } from "@/components/analytics/range-picker";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { topSignals } from "../../team/gaps/queries";

/** The card follows the page's range and its Team and Audience filters. */
export function FailedQuestions({ range, team, audience }: { range: Range; team?: string; audience?: Schemas["Audience"] }) {
  const q = useQuery({
    queryKey: ["admin", "analytics", "gaps", range.from, range.to, audience ?? ""],
    queryFn: async () => unwrap(await api.GET("/v1/admin/analytics/gaps", { params: { query: { from: range.from, to: range.to, audience } } })),
    enabled: Boolean(range.from && range.to),
  });
  const teams = (q.data?.teams ?? []).filter((t) => !team || t.slug === team);
  return (
    <Card title="Failed questions" description="Questions agents couldn't answer well, per team and reason. Counts only: teams' editors see the topics." flush>
      {q.isLoading ? (
        <Loading label="Loading failed questions…" />
      ) : q.error ? (
        <ErrorAlert error={q.error} title="Couldn't load failed questions" />
      ) : teams.length === 0 ? (
        <EmptyState size="compact" title={team || audience ? "No failed questions for these filters in this range." : "No failed questions in this range."} />
      ) : (
        <Table caption="Failed questions per team" columns={["Team", { label: "Failed questions", numeric: true }, "Main reasons"]}>
          {teams.map((t) => (
            <Tr key={t.teamId}>
              <Td>
                <TextLink render={<Link to="/admin/teams/$team" params={{ team: t.slug }} />}>{t.name}</TextLink>
              </Td>
              <Td numeric>{num(t.questions)}</Td>
              <Td>
                {topSignals(t.signals)
                  .slice(0, 3)
                  .map((x) => `${x.label} (${num(x.count)})`)
                  .join(", ")}
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
