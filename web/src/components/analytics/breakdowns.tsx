/* Analytics breakdown cards: stat groups, answers by audience or channel, and moderation by category. */
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { categoryLabel } from "@/lib/moderation";
import s from "@/pages/shared.module.css";
import { moderationByCategory, num, pct, type ModerationCount } from "./format";
import an from "./analytics.module.css";

/** A labelled row of stat cards; use 3 or 4 cards so none is left alone on a row. */
export function StatGroup({ id, title, columns, children }: { id: string; title: string; columns: 3 | 4; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={an.group}>
      <h2 id={id} className={an.groupTitle}>
        {title}
      </h2>
      <div className={columns === 3 ? s.stats3 : s.stats}>{children}</div>
    </section>
  );
}

export type ShareRow = { key: string; label: string; answers: number };

/** Answers by audience or channel, with each row's share of the total. */
export function ShareCard({ title, column, description, rows }: { title: string; column: string; description?: ReactNode; rows: ShareRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.answers, 0);
  return (
    <Card title={title} description={description} flush>
      {rows.length === 0 ? (
        <EmptyState size="compact" title="No answers yet." />
      ) : (
        <Table caption={`Answers per ${column.toLowerCase()}`} columns={[column, { label: "Answers", numeric: true }, { label: "Share", numeric: true }]}>
          {rows.map((r) => (
            <Tr key={r.key}>
              <Td>{r.label}</Td>
              <Td numeric>{num(r.answers)}</Td>
              <Td numeric>{pct(total ? r.answers / total : null)}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

/** Blocked and flagged questions and answers by category (content-free), with provider failures noted apart. */
export function ModerationCard({ counts }: { counts: ModerationCount[] }) {
  const { rows, errors } = moderationByCategory(counts);
  const failures = errors.input + errors.output;
  return (
    <Card title="Moderation by category" description="Questions and answers that moderation blocked or flagged. A blocked answer is withheld or retracted." flush>
      {rows.length === 0 && failures === 0 ? (
        <EmptyState size="compact" title="Nothing blocked or flagged." />
      ) : (
        <>
          {rows.length > 0 && (
            <Table
              caption="Blocked and flagged by category"
              columns={[
                "Category",
                { label: "Questions blocked", numeric: true },
                { label: "Questions flagged", numeric: true },
                { label: "Answers blocked", numeric: true },
                { label: "Answers flagged", numeric: true },
              ]}
            >
              {rows.map((r) => (
                <Tr key={r.category}>
                  <Td>{categoryLabel(r.category)}</Td>
                  <Td numeric>{num(r.inputBlock)}</Td>
                  <Td numeric>{num(r.inputFlag)}</Td>
                  <Td numeric>{num(r.outputBlock)}</Td>
                  <Td numeric>{num(r.outputFlag)}</Td>
                </Tr>
              ))}
            </Table>
          )}
          {failures > 0 && (
            <p className={an.note}>
              The moderation provider failed on {num(errors.input)} {errors.input === 1 ? "question" : "questions"} and {num(errors.output)}{" "}
              {errors.output === 1 ? "answer" : "answers"}; policies that fail closed refuse those.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
