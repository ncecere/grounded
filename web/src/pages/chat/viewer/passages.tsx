/*
 * The source viewer's text: the cited passage highlighted among its
 * neighbours, and (for the team's editors, admins and owners) the whole
 * document, a page of passages at a time around the cited one.
 */
import { useEffect, useRef, useState } from "react";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { LazyResponse } from "@/components/ui/response/response-lazy";
import { Loading } from "@/components/ui/spinner/spinner";
import type { Citation } from "../stream";
import { type ContextPassage, loadDocumentPage } from "./data";
import v from "./viewer.module.css";

/** Passages per page of the whole document, and how many before the cited one the first page starts. */
const PAGE = 50;
const LEAD = 10;

/** One passage; the cited one is marked for every reader: a bar and a background, and words for screen readers. */
function Passage({ p, citedRef }: { p: ContextPassage; citedRef?: React.Ref<HTMLDivElement> }) {
  // Passages quote team documents: never fetch image URLs from them. Their headings are all h3, under the viewer's
  // title (h2): a passage's own outline (an h5 alone) would skip levels (axe heading-order; mem-9).
  const text = (
    <LazyResponse images="alt" headingLevel={3}>
      {p.content}
    </LazyResponse>
  );
  if (!p.cited) return <div className={v.passage}>{text}</div>;
  return (
    <div className={v.cited} ref={citedRef} data-testid="cited-passage">
      <p className={v.citedLabel}>Cited passage</p>
      {text}
      <p className="sr-only">End of the cited passage.</p>
    </div>
  );
}

/** The cited passage with its neighbours (about a page), in document order, scrolled into view when it opens (mem-5). */
export function PassageList({ passages }: { passages: ContextPassage[] }) {
  const citedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // "nearest": the panel scrolls only when the passage is out of view, and keeps the context above it when it fits.
    citedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [passages]);
  return (
    <div className={v.passages}>
      {passages.map((p) => (
        <Passage key={p.ordinal} p={p} citedRef={p.cited ? citedRef : undefined} />
      ))}
    </div>
  );
}

type FullProps = { team: string; source: Pick<Citation, "sourceId" | "documentId">; cited?: number };

/** The whole document, from a little before the cited passage, with "Show earlier passages" and "Show later passages". */
export function FullDocument({ team, source, cited }: FullProps) {
  const [items, setItems] = useState<ContextPassage[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState<"start" | "earlier" | "later" | null>("start");
  const [error, setError] = useState<unknown>(null);
  const citedRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  const load = async (from: number, limit: number, where: "start" | "earlier" | "later") => {
    setBusy(where);
    setError(null);
    try {
      const page = await loadDocumentPage(team, source, from, limit);
      setTotal(page.total);
      setItems((cur) => {
        const byOrdinal = new Map([...cur, ...page.items].map((p) => [p.ordinal, p]));
        return [...byOrdinal.values()].sort((x, y) => x.ordinal - y.ordinal);
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void load(Math.max(0, (cited ?? 0) - LEAD), PAGE, "start");
    // Loads once per document: the viewer remounts this for another source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Bring the cited passage into view once it is there.
  useEffect(() => {
    if (scrolled.current || !citedRef.current) return;
    scrolled.current = true;
    citedRef.current.scrollIntoView?.({ block: "start" });
  }, [items]);

  if (busy === "start") return <Loading label="Loading the document…" />;
  const first = items[0]?.ordinal ?? 0;
  const last = items[items.length - 1]?.ordinal ?? -1;
  return (
    <div className={v.passages}>
      {error ? <ErrorAlert error={error} title="Couldn't load the document" /> : null}
      {first > 0 && (
        <Button variant="secondary" size="sm" className={v.more} loading={busy === "earlier"} onClick={() => void load(Math.max(0, first - PAGE), Math.min(PAGE, first), "earlier")}>
          Show earlier passages
        </Button>
      )}
      {items.length === 0 && !error && <p className={v.passage}>This document has no text.</p>}
      {items.map((p) => (
        <Passage key={p.ordinal} p={{ ...p, cited: p.ordinal === cited }} citedRef={p.ordinal === cited ? citedRef : undefined} />
      ))}
      {last + 1 < total && (
        <Button variant="secondary" size="sm" className={v.more} loading={busy === "later"} onClick={() => void load(last + 1, PAGE, "later")}>
          Show later passages
        </Button>
      )}
    </div>
  );
}
