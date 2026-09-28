/*
 * A full answer as chat shows it (docs/evaluations.md §3): the Markdown
 * answer with citation chips for its [n] markers, and its sources numbered
 * like the markers (one per number, as the answer cites them), the expected
 * documents marked. A chip previews its source and moves focus to it.
 */
import { useId, useState } from "react";
import { InlineCitation } from "@/components/ui/inline-citation/inline-citation";
import { LazyResponse } from "@/components/ui/response/response-lazy";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ui/sources/sources";
import s from "../../shared.module.css";
import type { EvalResult } from "./queries";
import e from "./evaluations.module.css";

type Hit = EvalResult["hits"][number];

export const webUrl = (u?: string) => (u && /^https?:\/\//.test(u) ? u : undefined);

/** "p. 3", "pp. 3–4", or "". */
const pages = (start?: number, end?: number) => (!start ? "" : !end || end === start ? `p. ${start}` : `pp. ${start}–${end}`);
/** Where in the document: "Fees › Online · p. 3". */
const where = (h: Hit) => [(h.headingPath ?? []).join(" › "), pages(h.pageStart, h.pageEnd)].filter(Boolean).join(" · ");
/** Snippets are raw passage text: drop Markdown heading and emphasis marks for display (as chat does). */
const plainSnippet = (t = "") => t.replace(/^#{1,6}\s+/gm, "").replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/\s+/g, " ").trim();
const titleOf = (h: Hit) => h.title || h.filename || "Untitled document";

export function EvalAnswer({ result }: { result: EvalResult }) {
  const id = useId();
  const [open, setOpen] = useState(true);
  // Results stored before citations were kept per marker have no numbers: their markers stay text.
  const cites = result.hits.filter((h) => h.n !== undefined);
  const byN = new Map(cites.map((h) => [h.n!, h]));
  const sourceId = (n: number) => `${id}-source-${n}`;
  const goTo = (n: number) => {
    setOpen(true);
    setTimeout(() => document.getElementById(sourceId(n))?.focus(), 30);
  };
  const renderCitation = (indices: number[]) => {
    const cited = indices.map((n) => byN.get(n));
    if (cited.some((h) => !h)) return undefined;
    return (
      <InlineCitation
        index={indices}
        sources={cited.map((h) => ({ title: titleOf(h!), href: webUrl(h!.url), siteName: where(h!) || undefined, description: plainSnippet(h!.snippet) }))}
        onActivate={() => goTo(indices[0]!)}
      />
    );
  };
  return (
    <div className={e.answer}>
      {result.answer ? (
        // Answers quote team documents: never fetch image URLs from them.
        <LazyResponse renderCitation={cites.length > 0 ? renderCitation : undefined} images="alt">
          {result.answer}
        </LazyResponse>
      ) : (
        <p className={s.muted}>The answer was empty.</p>
      )}
      {cites.length > 0 && (
        <Sources open={open} onOpenChange={setOpen}>
          <SourcesTrigger count={cites.length} />
          <SourcesContent label="Sources for this answer">
            {cites.map((h) => (
              <Source
                key={h.n}
                id={sourceId(h.n!)}
                tabIndex={-1}
                aria-label={`Source ${h.n}: ${titleOf(h)}${h.expected ? " (an expected document)" : ""}`}
                index={h.n}
                title={titleOf(h)}
                href={webUrl(h.url)}
                meta={[where(h), h.expected ? "Expected document" : ""].filter(Boolean).join(" · ") || undefined}
                description={plainSnippet(h.snippet) || undefined}
              />
            ))}
          </SourcesContent>
        </Sources>
      )}
    </div>
  );
}
