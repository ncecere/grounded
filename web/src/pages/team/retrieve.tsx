/* The "Try it" retrieval playground on the knowledge base page. */
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, FileText, Search, SearchX, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { ApiError, api, unwrap, type Schemas } from "../../api/client";
import { ApiErrorAlert } from "../../components/errors";
import { Button } from "@/components/ui/button/button";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { Popover } from "@/components/ui/popover/popover";
import { TextLink } from "@/components/ui/text-link/text-link";
import { Switch } from "@/components/ui/switch/switch";
import { useSystemOneStatus } from "@/lib/systemone";
import { FilterFields, type MetadataFilter, cleanFilter, describeFilter } from "./filters";
import { plural, useTeam } from "./common";
import { JudgingSummary, JudgmentLine } from "./judgment";
import r from "./retrieve.module.css";

type Hit = Schemas["RetrieveHit"];

/** "p. 3", "pp. 3–4", or "" when the hit has no page numbers. */
export function pageRange(start?: number | null, end?: number | null) {
  if (!start) return "";
  if (!end || end === start) return `p. ${start}`;
  return `pp. ${start}–${end}`;
}

function rankDetail(hit: Hit) {
  const parts = [];
  if (hit.vectorRank) parts.push(`vector #${hit.vectorRank}`);
  if (hit.lexicalRank) parts.push(`keyword #${hit.lexicalRank}`);
  return parts.join(" · ");
}

function friendlyError(err: unknown) {
  if (err instanceof ApiError && err.code === "model_unavailable") {
    return new Error("The embedding model is unavailable right now, so search can't run. Try again in a few minutes.");
  }
  return err;
}

export function RetrievePlayground({ kbId, defaultTopK, sources = [] }: { kbId: string; defaultTopK: number; sources?: { id: string; name: string }[] }) {
  const { slug, role } = useTeam();
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState("");
  const [filters, setFilters] = useState<MetadataFilter | undefined>(undefined);
  const systemOne = useSystemOneStatus();
  // SystemOne judging (docs/systemone.md §2): editors, once a SystemOne model is configured.
  const canJudge = Boolean(systemOne.data?.available) && (role === "owner" || role === "admin" || role === "editor");
  const [judge, setJudge] = useState(false);
  const run = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/kbs/{kbId}/retrieve", {
          params: { path: { team: slug, kbId } },
          body: { query: query.trim(), topK: topK ? Number(topK) : undefined, filters: cleanFilter(filters), judge: canJudge && judge ? true : undefined },
        }),
      ),
  });

  const active = cleanFilter(filters);
  const optionCount = (active ? Object.keys(active).length : 0) + (topK ? 1 : 0);
  return (
    <div className={r.playground}>
      {/* W4: one query row; filters and the result count are in a popover. */}
      <form
        className={r.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) run.mutate();
        }}
      >
        <div className={r.queryRow}>
          <Input
            aria-label="Question or search terms"
            className={r.query}
            startIcon={<Search />}
            maxLength={4000}
            placeholder="Ask a question or type search terms"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Popover
            title="Filters and options"
            align="end"
            className={r.popover}
            trigger={
              <Button variant="secondary">
                <SlidersHorizontal aria-hidden /> Filters{optionCount > 0 ? ` (${optionCount})` : ""}
              </Button>
            }
          >
            <div className={r.popoverBody}>
              <Field label="Passages per search" description={`1 to 50. Default: ${defaultTopK}.`} className={r.topK} disabled={canJudge && judge}>
                <Input type="number" min={1} max={50} disabled={canJudge && judge} placeholder={String(defaultTopK)} value={topK} onChange={(e) => setTopK(e.target.value)} />
              </Field>
              <FilterFields value={filters} onChange={setFilters} sources={sources.length > 1 ? sources : []} />
            </div>
          </Popover>
          <Button type="submit" loading={run.isPending}>
            <Search aria-hidden /> Search
          </Button>
        </div>
        {active && <p className={r.activeFilters}>Filters: {describeFilter(filters)}</p>}
        {canJudge && (
          <Switch
            className={r.judge}
            label="Judge with SystemOne"
            description={`Check the top ${systemOne.data?.judging.candidates ?? 20} passages as agents would: scores and routes.`}
            checked={judge}
            onCheckedChange={setJudge}
          />
        )}
      </form>
      <ApiErrorAlert error={run.error ? friendlyError(run.error) : null} />
      <p role="status" className={r.summary}>
        {run.data && `${plural(run.data.hits.length, "result")} in ${run.data.latencyMs.toLocaleString()} ms`}
      </p>
      {run.data?.judging && <JudgingSummary judging={run.data.judging} />}
      {run.data &&
        (run.data.hits.length === 0 ? (
          <EmptyState size="compact" icon={<SearchX />} title="No matching passages." description="Check that the attached sources have ready documents." />
        ) : (
          <ol aria-label="Search results" className={r.results}>
            {run.data.hits.map((h, i) => (
              <li key={h.chunkId || i}>
                <CitationCard hit={h} rank={i + 1} top={run.data.hits[0]?.score ?? 0} />
              </li>
            ))}
          </ol>
        ))}
    </div>
  );
}

function CitationCard({ hit, rank, top }: { hit: Hit; rank: number; top?: number }) {
  const pages = pageRange(hit.pageStart, hit.pageEnd);
  const detail = rankDetail(hit);
  const title = hit.title || hit.filename || "Untitled document";
  const external = /^https?:\/\//.test(hit.url);
  const showFilename = hit.filename && hit.filename !== title;
  const relevance = top && top > 0 ? Math.max(0.04, Math.min(1, hit.score / top)) : 0;
  const long = hit.content.length > 600 || hit.content.split("\n").length > 10;
  const [expanded, setExpanded] = useState(false);
  return (
    <article className={r.card}>
      <header className={r.header}>
        <h3 className={r.title}>
          <span className={r.rank}>
            {rank}
            <span className="sr-only">.</span>
          </span>{" "}
          {external ? (
            <a href={hit.url} target="_blank" rel="noreferrer" className={r.link}>
              {title}
              <ExternalLink aria-hidden className={r.linkIcon} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span>{title}</span>
          )}
        </h3>
        {(pages || showFilename) && (
          <p className={r.source}>
            {showFilename && (
              <span className={r.file}>
                <FileText aria-hidden className={r.fileIcon} />
                {hit.filename}
              </span>
            )}
            {pages && <span className={r.pages}>{pages}</span>}
          </p>
        )}
      </header>
      {external && (
        <p className={r.url}>
          <TextLink href={hit.url} target="_blank" rel="noreferrer" external tone="muted">
            {hit.url}
          </TextLink>
        </p>
      )}
      {hit.headingPath.length > 0 && <p className={r.path}>{hit.headingPath.join(" › ")}</p>}
      {/* Plain text: React escapes it, and pre-wrap keeps the line breaks. */}
      <div className={r.excerpt} data-clamped={long && !expanded ? "" : undefined}>
        <p className={r.content}>{hit.content}</p>
      </div>
      {long && (
        <Button variant="link" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className={r.more}>
          {expanded ? "Show less" : "Show the full passage"}
        </Button>
      )}
      <footer className={r.footer}>
        {relevance > 0 && (
          <span aria-hidden className={r.meter}>
            <span className={r.meterFill} style={{ width: `${Math.round(relevance * 100)}%` }} />
          </span>
        )}
        <span>
          Score {hit.score.toFixed(4)}
          {detail && ` · ${detail}`}
        </span>
      </footer>
      {hit.judgment && <JudgmentLine judgment={hit.judgment} />}
    </article>
  );
}
