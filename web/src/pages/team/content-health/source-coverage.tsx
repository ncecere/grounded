/* What a report knew about each source in its scope (docs/content-health.md): documents, and whether links were observed, unknown or not applicable. */
import { Link } from "@tanstack/react-router";
import { RelativeTime } from "@/components/templates/list-page";
import { Card } from "@/components/ui/card/card";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { type Coverage, citeStateText, linkRefsText, linkStateText } from "./queries";
import s from "./content-health.module.css";

export function SourceCoverage({ sources, team, minAnswers }: { sources: Coverage[]; team: string; minAnswers: number }) {
  return (
    <Card
      title="Sources in this report"
      titleAs="h2"
      description="What the report could see in each source when it was made: the numbers are as of the report, while the findings above are checked against your sources each time you open them, and sources taken out of the report's scope are not listed. A web source's links are known only from its latest completed crawl; ready documents without a processing date or a hash are counted but not judged."
    >
      <Table
        caption="Sources in this report"
        stack
        columns={["Source", { label: "Documents", numeric: true }, { label: "Ready", numeric: true }, "Links", "Citation evidence", "Not judged"]}
        empty={sources.length === 0 ? <p>No source of this team was in the scope.</p> : undefined}
      >
        {sources.map((c) => (
          <Tr key={c.sourceId}>
            <Td>
              <TextLink render={<Link to="/teams/$team/sources/$sourceId" params={{ team, sourceId: c.sourceId }} />}>{c.name}</TextLink>
              <span className={s.muted}> {c.type === "web" ? "Web" : "Upload"}</span>
            </Td>
            <Td numeric>{c.documents.toLocaleString()}</Td>
            <Td numeric>{c.ready.toLocaleString()}</Td>
            <Td>
              {linkStateText(c)}
              {c.linkCrawlAt && (
                <span className={s.muted}>
                  {" "}
                  (crawl ended <RelativeTime value={c.linkCrawlAt} />)
                </span>
              )}
              {linkRefsText[c.linkRefs] && <span className={s.muted}> {linkRefsText[c.linkRefs]}</span>}
            </Td>
            <Td muted>
              {citeStateText(c, minAnswers)}
              {c.exposedSince && (
                <>
                  {" "}
                  (reachable since <RelativeTime value={c.exposedSince} />)
                </>
              )}
            </Td>
            <Td muted>
              {c.readyWithoutDate > 0 && `${c.readyWithoutDate.toLocaleString()} without a date. `}
              {c.readyWithoutHash > 0 && `${c.readyWithoutHash.toLocaleString()} without a hash.`}
              {c.readyWithoutDate === 0 && c.readyWithoutHash === 0 && "None"}
            </Td>
          </Tr>
        ))}
      </Table>
    </Card>
  );
}
