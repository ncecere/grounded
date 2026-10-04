/*
 * The source viewer (docs/v0.4.0.md §5, B10 and A13): a cited passage,
 * highlighted, among its neighbours under the document's title and heading
 * path, with the claims of the answer that cite it and this source's verdict
 * on each. Web pages offer "Open the page" (a text fragment highlights the
 * passage on the live site); the team's editors, admins and owners also
 * "Open full document". The answer's other sources are one click away.
 *
 * Keyboard: the title takes focus when a source opens (host.tsx; the sheet's
 * title on phones), the cited passage scrolls into view (passages.tsx),
 * Escape closes the panel and focus goes back to what opened it.
 */
import { useQuery } from "@tanstack/react-query";
import { FileText, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button, IconButton } from "@/components/ui/button/button";
import { Loading } from "@/components/ui/spinner/spinner";
import { TextLink } from "@/components/ui/text-link/text-link";
import { cx } from "@/lib/bitop-utils";
import { displayNumbers } from "../citations";
import type { Claim } from "../claims";
import type { AssistantItem, Citation } from "../stream";
import { sourceTitle } from "../thread";
import { type ViewerAccess, type ViewerData, loadViewer } from "./data";
import { FullDocument, PassageList } from "./passages";
import { textFragmentUrl } from "./text-fragment";
import v from "./viewer.module.css";

type Props = {
  item: AssistantItem;
  n: number;
  access: ViewerAccess;
  onClose: () => void;
  /** Show another source of the same answer. */
  onOpen: (n: number) => void;
  /** In the phone's sheet: no header of its own (the sheet's names it and closes it). */
  bare?: boolean;
};

const pagesOf = (c: Citation) => (!c.pageStart ? "" : !c.pageEnd || c.pageEnd === c.pageStart ? `p. ${c.pageStart}` : `pp. ${c.pageStart}–${c.pageEnd}`);
const isWeb = (url?: string) => Boolean(url && /^https?:\/\//.test(url));

/** "Source 2 of 3" and where the passage is ("Fees › Transcripts · p. 4"). */
export function viewerCaption(item: AssistantItem, n: number) {
  const sources = item.citations.filter((s) => s.kind !== "tool");
  return `Source ${displayNumbers(item.citations, item.text)(n)} of ${sources.length}`;
}

const checkTone = { verified: "success", unsupported: "warning", contradicted: "danger", unchecked: "neutral" } as const;
const checkText = { verified: "Supported", unsupported: "Not supported", contradicted: "Contradicted", unchecked: "Not checked" } as const;

/** The claims citing source n, each with this source's verdict on it. */
function ClaimsCiting({ claims, n }: { claims: Claim[]; n: number }) {
  const id = useId();
  const citing = claims.flatMap((c) => {
    const k = c.checks?.find((x) => x.n === n);
    return k ? [{ claim: c, verification: k.verification }] : [];
  });
  if (citing.length === 0) return null;
  return (
    <section className={v.claims} aria-labelledby={id}>
      <h3 id={id} className={v.claimsTitle}>
        {citing.length === 1 ? "The claim citing this source" : `${citing.length} claims citing this source`}
      </h3>
      <ul className={v.claimList}>
        {citing.map(({ claim, verification }) => (
          <li key={claim.index} className={v.claim}>
            <Badge tone={checkTone[verification]} size="sm" className={v.claimBadge}>
              {checkText[verification]}
            </Badge>
            <span>{claim.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What can be shown instead of the passage, and why. */
function Unavailable({ data, c }: { data: ViewerData; c: Citation }) {
  const title =
    data.status === "document_deleted"
      ? "This document was deleted after the answer was written."
      : data.status === "passage_changed"
        ? "This passage is no longer in the document. The document changed after the answer was written."
        : "Only the quoted text of this source can be shown here.";
  return (
    <>
      <Alert tone={data.status === "snippet" ? "info" : "warning"} title={title} />
      {c.snippet && (
        <figure className={v.passages}>
          <figcaption className={v.where}>What the answer quoted:</figcaption>
          <blockquote className={v.quote}>{c.snippet}</blockquote>
        </figure>
      )}
    </>
  );
}

/** The answer's sources as numbered buttons, the current one marked. */
function SourceNav({ item, n, onOpen }: { item: AssistantItem; n: number; onOpen: (n: number) => void }) {
  const num = displayNumbers(item.citations, item.text);
  const sources = item.citations.filter((s) => s.kind !== "tool").sort((x, y) => num(x.n) - num(y.n));
  if (sources.length < 2) return null;
  return (
    <nav aria-label="Sources of this answer" className={v.nav}>
      <span className={v.navLabel} aria-hidden>
        Sources
      </span>
      {sources.map((s) => (
        <Button
          key={s.n}
          size="sm"
          variant={s.n === n ? "secondary" : "ghost"}
          aria-current={s.n === n ? "true" : undefined}
          aria-label={`Source ${num(s.n)}: ${sourceTitle(s)}`}
          onClick={() => onOpen(s.n)}
        >
          {num(s.n)}
        </Button>
      ))}
    </nav>
  );
}

export function SourceViewer({ item, n, access, onClose, onOpen, bare = false }: Props) {
  const c = item.citations.find((s) => s.n === n);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [full, setFull] = useState(false);
  const key = access.kind === "team" ? access.team : access.kind === "public" ? access.agentId : "message";
  const data = useQuery({
    queryKey: ["source-viewer", key, item.id ?? item.key, n, c?.chunkId ?? null, item.status === "streaming"],
    queryFn: () => loadViewer(access, item, c!),
    enabled: Boolean(c),
    retry: false,
    staleTime: 60_000,
  });
  // A new source: its title takes focus (not in the sheet, which focuses itself), and the passage view comes back.
  useEffect(() => {
    setFull(false);
    if (!bare) heading.current?.focus({ preventScroll: true });
  }, [n, item.key, bare]);

  if (!c) return null;
  const d = data.data;
  const where = [(d?.headingPath ?? c.headingPath).join(" › "), pagesOf(c)].filter(Boolean).join(" · ");
  const cited = d?.passages.find((p) => p.cited);
  const claims = item.claims ?? d?.claims ?? [];
  const team = d?.documentTeam;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !bare) {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    // In the sheet, the sheet (and its scrolling body) is named by the title: no second region of the same name.
    <section className={cx(v.viewer, bare && v.bare)} aria-labelledby={bare ? undefined : headingId} onKeyDown={onKeyDown} data-testid="source-viewer">
      {!bare && (
        <header className={v.head}>
          <div className={v.headText}>
            <p className={v.eyebrow}>{viewerCaption(item, n)}</p>
            <h2 id={headingId} ref={heading} tabIndex={-1} className={v.title}>
              {sourceTitle(c)}
            </h2>
            {where && <p className={v.where}>{where}</p>}
          </div>
          <IconButton size="sm" icon={<X aria-hidden />} label="Close the source" onClick={onClose} />
        </header>
      )}
      {bare && where && <p className={v.where}>{where}</p>}
      <SourceNav item={item} n={n} onOpen={onOpen} />
      {(isWeb(c.url) || (team && d?.status !== "document_deleted")) && (
        <div className={v.actions}>
          {isWeb(c.url) && (
            <TextLink href={cited ? textFragmentUrl(c.url!, cited.content) : c.url} external>
              Open the page
            </TextLink>
          )}
          {team && d?.status !== "document_deleted" && (
            <Button variant="secondary" size="sm" onClick={() => setFull((f) => !f)}>
              <FileText aria-hidden /> {full ? "Show the passage only" : "Open full document"}
            </Button>
          )}
        </div>
      )}
      <ClaimsCiting claims={claims} n={n} />
      {data.isLoading ? (
        <Loading label="Loading the passage…" />
      ) : data.error ? (
        <ErrorAlert error={data.error} title="Couldn't open this source" />
      ) : full && team ? (
        <FullDocument key={`${c.documentId}`} team={team} source={c} cited={cited?.ordinal} />
      ) : d?.status === "available" ? (
        <PassageList passages={d.passages} />
      ) : d ? (
        <Unavailable data={d} c={c} />
      ) : null}
    </section>
  );
}
