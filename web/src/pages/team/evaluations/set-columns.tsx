/*
 * The columns every list of evaluation sets shares, so the team's
 * Evaluations page and a knowledge base's or agent's Evaluations tab read
 * alike: Set (a link, with its description) · Questions · Score (the latest
 * run's, with when it ran) · Trend (against the latest earlier scored run).
 * The team page adds what each set tests; the tab adds Automatic runs.
 */
import { Link } from "@tanstack/react-router";
import { RelativeTime } from "@/components/templates/list-page";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { plural } from "../common";
import { runScore } from "./labels";
import type { EvalSet } from "./queries";
import { LastScore, TrendValue } from "./score";
import { setTrend } from "./trend";

type Column = DataTableColumn<EvalSet>;

export function setColumns(slug: string): { name: Column; questions: Column; score: Column; trend: Column } {
  return {
    name: {
      id: "name",
      header: "Set",
      rowHeader: true,
      sortable: true,
      accessor: (x) => x.name,
      // A link, like the knowledge base and agent lists: it can be opened in a new tab or copied (no row menu repeats it).
      cell: (x) => (
        <CellText
          primary={
            <TextLink render={<Link to="/teams/$team/evaluations/$setId" params={{ team: slug, setId: x.id }} />} className={s.primary}>
              {x.name}
            </TextLink>
          }
          secondary={x.description || undefined}
        />
      ),
    },
    questions: {
      id: "questions",
      header: "Questions",
      sortable: true,
      defaultHiddenNarrow: true,
      accessor: (x) => x.questionCount,
      cell: (x) => plural(x.questionCount, "question"),
    },
    score: {
      id: "score",
      header: "Score",
      sortable: true,
      accessor: (x) => (x.lastRun ? (runScore(x.lastRun) ?? -1) : -2),
      cell: (x) => <CellText primary={<LastScore set={x} />} secondary={x.lastRun ? <RelativeTime value={x.lastRun.createdAt} /> : undefined} />,
    },
    trend: { id: "trend", header: "Trend", sortable: true, accessor: (x) => setTrend(x).points ?? 0, cell: (x) => <TrendValue set={x} /> },
  };
}
