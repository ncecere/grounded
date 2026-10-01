/*
 * The gap topics table (docs/gaps.md): the Gaps page's tabs and the agent's
 * Analytics tab. A row is a topic's label (or "Not labelled yet"), its
 * agent, its main signals, its weekly trend, how many questions and askers,
 * and when it was last asked; never a question's text. The label links to
 * the topic's record page (?record= on the Gaps page).
 */
import { Link } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { ListPage, timeColumn } from "@/components/templates/list-page";
import { RecordLink } from "@/components/templates/record-page";
import { Badge } from "@/components/ui/badge/badge";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Sparkline } from "@/components/ui/sparkline/sparkline";
import { TextLink } from "@/components/ui/text-link/text-link";
import { plural } from "../common";
import { type GapTopic, stateLabels, stateTones, topSignals, topicName, trendLabel } from "./queries";
import s from "./gaps.module.css";

type Props = {
  team: string;
  topics: GapTopic[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** On the Gaps page the label opens the record in place; elsewhere it links to the Gaps page. */
  inPlace?: boolean;
  /** Leave out the agent column (one agent's topics). */
  hideAgent?: boolean;
  /** Show each topic's state (the closed tab). */
  showState?: boolean;
  emptyTitle: string;
  emptyDescription: string;
};

export function GapTopicsTable({ team, topics, loading, error, onRetry, inPlace, hideAgent, showState, emptyTitle, emptyDescription }: Props) {
  const name = (t: GapTopic) =>
    inPlace ? (
      <RecordLink id={t.id}>{topicName(t)}</RecordLink>
    ) : (
      <TextLink render={<Link to="/teams/$team/gaps" params={{ team }} search={{ record: t.id } as never} />}>{topicName(t)}</TextLink>
    );
  const columns: DataTableColumn<GapTopic>[] = [
    {
      id: "topic",
      header: "Topic",
      sortable: true,
      accessor: (t) => topicName(t),
      cell: (t) => <CellText primary={name(t)} secondary={hideAgent ? undefined : t.agentName} />,
    },
    ...(showState
      ? [{ id: "state", header: "State", accessor: (t: GapTopic) => stateLabels[t.state], cell: (t: GapTopic) => <Badge tone={stateTones[t.state]}>{stateLabels[t.state]}</Badge> }]
      : []),
    {
      id: "signals",
      header: "Why they failed",
      defaultHiddenNarrow: true,
      accessor: (t) => topSignals(t.signals).map((x) => x.label).join(", "),
      cell: (t) => (
        <span className={s.signals}>
          {topSignals(t.signals)
            .slice(0, 2)
            .map((x) => (
              <Badge key={x.key} tone="neutral">
                {x.label} · {x.count}
              </Badge>
            ))}
        </span>
      ),
    },
    {
      id: "trend",
      header: "Last 8 weeks",
      defaultHiddenNarrow: true,
      accessor: (t) => t.last30Days,
      cell: (t) => <Sparkline className={s.trend} size="sm" values={t.trend} label={trendLabel(t.trend)} />,
    },
    {
      id: "questions",
      header: "Questions",
      sortable: true,
      accessor: (t) => t.questions,
      cell: (t) => <CellText primary={plural(t.questions, "question")} secondary={plural(t.askers, "person", "people")} />,
    },
    timeColumn<GapTopic>("lastSeen", "Last asked", (t) => t.lastSeen),
  ];
  return (
    <ListPage<GapTopic>
      id={hideAgent ? "agent-gap-topics" : "team-gap-topics"}
      caption="Topics"
      columns={columns}
      data={topics}
      getRowId={(t) => t.id}
      rowLabel={(t) => topicName(t)}
      empty={{ icon: <SearchX />, title: emptyTitle, description: emptyDescription }}
      tableProps={{ columnsMenuMin: 5 }}
      loading={loading}
      error={error}
      onRetry={onRetry}
    />
  );
}
