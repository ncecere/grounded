/* Answers and conversations per day: a CSS bar chart (one image with a text summary) and the same data as a table. */
import { Activity, Download } from "lucide-react";
import type { ReactNode } from "react";
import { BarChart } from "@/components/ui/bar-chart/bar-chart";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { dailySummary, dayLabel, num } from "./format";
import an from "./analytics.module.css";

export type DailyRow = { date: string; answers: number; conversations: number };

type Column<T> = { label: string; value: (row: T) => number };

type Props<T extends DailyRow> = {
  days: T[];
  description: ReactNode;
  /** Extra numeric table columns after answers and conversations. */
  extra?: Column<T>[];
  /** A CSV download of the table. */
  csvHref?: string;
};

export function DailyChart<T extends DailyRow>({ days, description, extra = [], csvHref }: Props<T>) {
  const total = days.reduce((s, d) => s + d.answers + d.conversations, 0);
  const actions = csvHref ? (
    <Button variant="secondary" size="sm" render={<a href={csvHref} download />}>
      <Download aria-hidden /> Download CSV
    </Button>
  ) : undefined;
  return (
    <Card title="Answers per day" description={description} actions={actions}>
      {total === 0 ? (
        <EmptyState size="compact" icon={<Activity />} title="No answers in this range." />
      ) : (
        <div className={an.chartBody}>
          <BarChart
            data={days.map((d) => ({ label: dayLabel(d.date), values: { answers: d.answers, conversations: d.conversations } }))}
            series={[
              { key: "answers", label: "Answers", tone: "info" },
              { key: "conversations", label: "Conversations started" },
            ]}
            summary={dailySummary(days)}
          />
          <Table
            caption="Answers and conversations per day"
            columns={["Day", { label: "Answers", numeric: true }, { label: "Conversations", numeric: true }, ...extra.map((c) => ({ label: c.label, numeric: true }))]}
            maxHeight="16rem"
            stickyHeader
            density="compact"
          >
            {days
              .filter((d) => d.answers || d.conversations)
              .map((d) => (
                <Tr key={d.date}>
                  <Td nowrap>
                    <time dateTime={d.date}>{dayLabel(d.date)}</time>
                  </Td>
                  <Td numeric>{num(d.answers)}</Td>
                  <Td numeric>{num(d.conversations)}</Td>
                  {extra.map((c) => (
                    <Td key={c.label} numeric>
                      {num(c.value(d))}
                    </Td>
                  ))}
                </Tr>
              ))}
          </Table>
        </div>
      )}
    </Card>
  );
}
