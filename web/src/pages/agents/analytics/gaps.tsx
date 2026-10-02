/*
 * The agent's gap topics in its Analytics tab (?view=gaps; docs/gaps.md):
 * the open topics of this agent's failed questions, each linking to its
 * record on the team's Gaps page. Topics show once 3 different people asked.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TextLink } from "@/components/ui/text-link/text-link";
import { gapTopicsQuery, pendingNote } from "../../team/gaps/queries";
import { GapTopicsTable } from "../../team/gaps/topics-table";
import an from "./analytics.module.css";

export function GapsView({ team, agentId, agentName }: { team: string; agentId: string; agentName: string }) {
  const q = useQuery(gapTopicsQuery(team, { agentId, state: "open" }));
  const note = q.data ? pendingNote(q.data) : undefined;
  return (
    <section aria-label="Open gap topics" className={an.gaps}>
      <p className={an.note}>
        Open topics of questions {agentName} couldn't answer well. A topic shows once 3 different people asked about it.{" "}
        <TextLink render={<Link to="/teams/$team/gaps" params={{ team }} />}>All of the team's gaps</TextLink>.
      </p>
      <GapTopicsTable
        team={team}
        topics={q.data?.topics ?? []}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        hideAgent
        emptyTitle="No open topics."
        emptyDescription={note ? `${note.title} ${note.detail}` : "When several people ask something this agent can't answer, the topic shows here."}
      />
    </section>
  );
}
