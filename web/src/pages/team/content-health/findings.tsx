/*
 * The findings of one signal (docs/content-health.md): a page at a time (Previous / Next), with the live names of their documents
 * and sources. A document opens its source's page, which authorizes again; an address that failed is text, never a link the page
 * follows. "Changed since this report" marks a document that was processed again after the report began.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PagerBar, useCursorPager } from "@/components/pager";
import { RelativeTime } from "@/components/templates/list-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Skeleton } from "@/components/ui/skeleton/skeleton";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { FINDINGS_PAGE, type Finding, type Report, type SignalName, failureClassLabel, findingsQuery, linkCodeLabel, signalWords } from "./queries";
import s from "./content-health.module.css";

const COLUMNS: Record<SignalName, string[]> = {
  stale: ["Document", "Last processed", "Last confirmed by a crawl"],
  broken_link: ["Address", "What happened", "Source", "Seen at"],
  duplicate: ["Document", "Same file", "Last processed"],
  never_cited: ["Document", "In a knowledge base", "Added"],
  ingestion_failure: ["Document", "What happened", "Since"],
};

/** A document's name: its title, else its file name, else its address. */
export const documentName = (f: Pick<Finding, "title" | "filename" | "url">) => f.title || f.filename || f.url || "Untitled document";

function DocCell({ f, team }: { f: Finding; team: string }) {
  return (
    <Td>
      <span className={s.cellStack}>
        <TextLink render={<Link to="/teams/$team/sources/$sourceId" params={{ team, sourceId: f.sourceId }} />}>{documentName(f)}</TextLink>
        <span className={s.muted}>{f.sourceName}</span>
        {f.changedSinceReport && <Badge tone="info">Changed since this report</Badge>}
      </span>
    </Td>
  );
}

function Row({ f, team }: { f: Finding; team: string }) {
  switch (f.signal) {
    case "stale":
      return (
        <Tr>
          <DocCell f={f} team={team} />
          <Td>
            <RelativeTime value={f.observedAt} /> <span className={s.muted}>({f.value.toLocaleString()} days)</span>
          </Td>
          <Td muted>{f.confirmedAt ? <RelativeTime value={f.confirmedAt} /> : "Unknown"}</Td>
        </Tr>
      );
    case "broken_link":
      return (
        <Tr>
          <Td>
            <span className={s.address}>{f.ref}</span>
          </Td>
          <Td>
            {linkCodeLabel[f.code] ?? f.code}
            {f.value > 0 && <span className={s.muted}> (status {f.value})</span>}
          </Td>
          <Td muted>
            <TextLink render={<Link to="/teams/$team/sources/$sourceId" params={{ team, sourceId: f.sourceId }} />}>{f.sourceName}</TextLink>
          </Td>
          <Td muted>
            <RelativeTime value={f.observedAt} />
          </Td>
        </Tr>
      );
    case "duplicate":
      return (
        <Tr>
          <DocCell f={f} team={team} />
          <Td>
            Group {f.groupNo} <span className={s.muted}>({f.groupSize.toLocaleString()} documents)</span>
          </Td>
          <Td muted>
            <RelativeTime value={f.observedAt} />
          </Td>
        </Tr>
      );
    case "never_cited":
      return (
        <Tr>
          <DocCell f={f} team={team} />
          <Td>{f.inKnowledgeBase ? "Yes" : "No: it can't be cited"}</Td>
          <Td muted>
            <RelativeTime value={f.observedAt} />
          </Td>
        </Tr>
      );
    default:
      return (
        <Tr>
          <DocCell f={f} team={team} />
          <Td>
            {failureClassLabel[f.code] ?? f.code}
            {f.detail && <span className={s.muted}> ({f.detail})</span>}
          </Td>
          <Td muted>
            <RelativeTime value={f.observedAt} />
          </Td>
        </Tr>
      );
  }
}

/** Mount it with a key of the report and the signal: another one starts at its first page. */
export function Findings({ team, report, signal }: { team: string; report: Report; signal: SignalName }) {
  const pager = useCursorPager();
  const q = useQuery(findingsQuery(team, report.id, signal, pager.cursor));
  const words = signalWords[signal];
  const rows = q.data?.items ?? [];
  return (
    <Card title={words.title} titleAs="h2" description={`As of the report. ${words.measures}`}>
      {q.error ? (
        <ErrorAlert error={q.error} title="Couldn't load the findings" onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton height="6rem" />
      ) : (
        <>
          <Table caption={`${words.title}: findings`} columns={COLUMNS[signal]} stack empty={rows.length === 0 ? <EmptyState title="Nothing is listed." description="Findings are removed when their document or source is deleted." /> : undefined}>
            {rows.map((f) => (
              <Row key={f.ord} f={f} team={team} />
            ))}
          </Table>
          <PagerBar pager={pager} pageSize={FINDINGS_PAGE} shown={rows.length} nextCursor={q.data.nextCursor} label={`${words.title} pages`} />
        </>
      )}
    </Card>
  );
}
