/*
 * A full answer as chat shows it (docs/evaluations.md §3): the Markdown
 * answer with citation chips for its [n] markers, and its sources numbered
 * like the markers (one per number, as the answer cites them), the expected
 * documents marked. It uses chat's marker renderer (chat/citations.tsx), so
 * with SystemOne citation checks each chip shows its claim's verdict, its
 * card the claim, and the answer the same claims summary as in chat
 * ("2 of 3 claims supported · 1 uncited"). A chip previews its source and
 * moves focus to it; the sources start collapsed, as in chat.
 */
import { useCallback, useId, useMemo, useState } from "react";
import { LazyResponse } from "@/components/ui/response/response-lazy";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ui/sources/sources";
import { useAnswerMarkers, withUncited } from "../../chat/citations";
import { ClaimSummary, uncitedOfClaims } from "../../chat/claims";
import type { Citation } from "../../chat/stream";
import s from "../../shared.module.css";
import type { EvalResult } from "./queries";
import e from "./evaluations.module.css";

type Hit = EvalResult["hits"][number];

export const webUrl = (u?: string) => (u && /^https?:\/\//.test(u) ? u : undefined);

/** "p. 3", "pp. 3–4", or "". */
const pages = (start?: number, end?: number) => (!start ? "" : !end || end === start ? `p. ${start}` : `pp. ${start}–${end}`);
/** Where in the document: "Fees › Online · p. 3". */
const where = (h: Pick<Hit, "headingPath" | "pageStart" | "pageEnd">) =>
  [(h.headingPath ?? []).join(" › "), pages(h.pageStart, h.pageEnd)].filter(Boolean).join(" · ");
/** Snippets are raw passage text: drop Markdown heading and emphasis marks for display (as chat does). */
export const plainSnippet = (t = "") => t.replace(/^#{1,6}\s+/gm, "").replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/\s+/g, " ").trim();
const titleOf = (h: Hit) => h.title || h.filename || "Untitled document";

/** A cited hit in chat's citation shape, for the marker renderer. */
const asCitation = (h: Hit): Citation => ({
  n: h.n!,
  documentId: h.documentId,
  sourceId: "",
  title: titleOf(h),
  snippet: h.snippet ?? "",
  headingPath: h.headingPath ?? [],
  pageStart: h.pageStart,
  pageEnd: h.pageEnd,
  url: webUrl(h.url),
});
/** What a chip's card shows about its source. */
const chipSource = (c: Citation) => ({ title: c.title, href: c.url, siteName: where(c) || undefined, description: plainSnippet(c.snippet) });

export function EvalAnswer({ result }: { result: EvalResult }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Results stored before citations were kept per marker have no numbers: their markers stay text.
  const cites = useMemo(() => result.hits.filter((h) => h.n !== undefined), [result.hits]);
  const citations = useMemo(() => cites.map(asCitation), [cites]);
  const sourceId = useCallback((n: number) => `${id}-source-${n}`, [id]);
  const goTo = useCallback(
    (n: number) => {
      setOpen(true);
      setTimeout(() => document.getElementById(sourceId(n))?.focus(), 30);
    },
    [sourceId],
  );
  const markers = useAnswerMarkers(citations, goTo, chipSource, result.claims);
  const text = result.answer ? withUncited(result.answer, result.claims ? uncitedOfClaims(result.claims) : undefined) : "";
  return (
    <div className={e.answer}>
      {result.answer ? (
        // Answers quote team documents: never fetch image URLs from them.
        <LazyResponse images="alt" {...(cites.length > 0 || result.claims ? markers : {})}>
          {text}
        </LazyResponse>
      ) : (
        <p className={s.muted}>The answer was empty.</p>
      )}
      <ClaimSummary claims={result.claims} />
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
