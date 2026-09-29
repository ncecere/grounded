/*
 * One question's result (docs/evaluations.md §2-§4): Expected (each expected
 * document, whether it's in the knowledge base, and the rank it came back
 * at, beyond k when the deeper search found it) beside What came back
 * (numbered 1-n, one row per document, with the expected ones marked and
 * the start of the passage), or for full answers the answer with its
 * citations and its scores.
 */
import { Badge } from "@/components/ui/badge/badge";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { EvalAnswer, plainSnippet, webUrl } from "./answer";
import { citedOnly, legacyShare, legacyShareLabel, pct } from "./labels";
import type { EvalExpectedItem, EvalResult } from "./queries";
import e from "./evaluations.module.css";

type Hit = EvalResult["hits"][number];

/** The best rank an expected document came back at, and whether only the deeper search found it. */
export function expectedRank(r: Pick<EvalResult, "expectedItems" | "k">) {
  const ranks = r.expectedItems.map((it) => it.rank).filter((n): n is number => n !== undefined);
  if (ranks.length === 0) return undefined;
  const best = Math.min(...ranks);
  return { rank: best, beyond: r.k !== undefined && best > r.k };
}

/** "#2", "#11 (beyond the top 6)" or "—": the Rank column of a retrieval run. */
export function rankCell(r: Pick<EvalResult, "rank" | "expectedItems" | "k" | "status">) {
  if (r.rank) return `#${r.rank}`;
  const deep = r.status === "fail" ? expectedRank(r) : undefined;
  return deep ? `#${deep.rank} (beyond the top ${r.k})` : "—";
}

/** The result in one sentence, said once (the result page's description). */
export function verdictText(r: EvalResult) {
  if (r.status === "error") return r.error || "The check failed.";
  if (r.status === "missing") {
    if (r.missingReason === "not_indexed")
      return "No document in the knowledge base matches the expected documents, so this question wasn't scored. It'll count once one is added.";
    if (r.missingReason === "deleted") return "The expected document was in the knowledge base but has been deleted since, so this question wasn't scored.";
    return "No expected document is in the knowledge base, so this question wasn't scored.";
  }
  if (r.scores) {
    if (citedOnly(r)) return "The answer cited the right source. What it says wasn't checked: the question has no must-mention phrases.";
    return r.status === "pass" ? "The answer cited an expected document and mentioned every phrase." : `${whyText(r)}.`;
  }
  if (r.rank) return `An expected document came back at #${r.rank}.`;
  const deep = expectedRank(r);
  const top = r.k ? `the top ${r.k}` : "the top results";
  if (deep) return `No expected document in ${top}: the first came back at #${deep.rank}.`;
  return r.searchDepth ? `No expected document in ${top}, nor in the top ${r.searchDepth}.` : `No expected document in ${top}.`;
}

/** Why a question didn't pass, in a few words: the first failed score of a full answer ("Doesn't mention “fee”"), or "" when it passed. */
export function whyText(r: Pick<EvalResult, "status" | "rank" | "scores" | "error" | "missingReason">) {
  if (r.status === "pass") return "";
  if (r.status === "error") return r.error || "The check failed.";
  if (r.status === "missing") return r.missingReason === "deleted" ? "Document deleted" : r.missingReason === "not_indexed" ? "Not in this knowledge base" : "Not scored";
  const sc = r.scores;
  if (!sc) return "No expected document in the top results";
  if (sc.refused) return "Refused to answer";
  if (!sc.cited) return "Doesn't cite an expected document";
  const missed = sc.mentions.find((m) => !m.found);
  return missed ? `Doesn't mention “${missed.phrase}”` : "";
}

/** The documents that came back, each once (the answer's citations can repeat one). */
export const hitTitles = (hits: Hit[]) => [...new Set(hits.map((h) => h.title || h.filename || h.url || "Untitled document"))].join(", ");

const stateLook: Record<EvalExpectedItem["state"], { label: string; tone: "success" | "warning" }> = {
  indexed: { label: "In the knowledge base", tone: "success" },
  not_indexed: { label: "Not in this knowledge base", tone: "warning" },
  deleted: { label: "Deleted since", tone: "warning" },
};

/** An expected document's name: the matching document's title, then what the question says when that's different. */
function itemName(it: EvalExpectedItem) {
  if (it.kind === "document") return it.title || "A picked document";
  return it.title && it.title !== it.value ? `${it.title} · ${it.value}` : it.value;
}

function ExpectedItem({ it, result }: { it: EvalExpectedItem; result: EvalResult }) {
  const look = stateLook[it.state];
  const ranked = result.answer === null || result.answer === undefined;
  let where = "";
  if (ranked && it.state === "indexed" && (result.status === "pass" || result.status === "fail"))
    where = it.rank === undefined ? `Not in the top ${result.searchDepth ?? result.k ?? "results"}` : result.k && it.rank > result.k ? `Found at #${it.rank}, beyond the top ${result.k}` : `Came back at #${it.rank}`;
  return (
    <li>
      <span className={e.itemName}>{itemName(it)}</span> <Badge tone={look.tone}>{look.label}</Badge>
      {where && <span className={s.secondary}>{where}</span>}
    </li>
  );
}

/** The expected documents; `heading`: under an "Expected" heading of their own (beside What came back), not a card's title. */
export function Expected({ result: r, heading = true }: { result: EvalResult; heading?: boolean }) {
  return (
    <div>
      {heading && <h3 className={e.columnTitle}>Expected</h3>}
      {r.expectedItems.length === 0 ? (
        <p className={s.muted}>This run didn't record the expected documents.</p>
      ) : (
        <ul className={e.items}>
          {r.expectedItems.map((it) => (
            <ExpectedItem key={`${it.kind}:${it.value}`} it={it} result={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function HitName({ hit: h, duplicate }: { hit: Hit; duplicate: boolean }) {
  const name = h.title || h.filename || h.url || "Untitled document";
  return (
    <>
      {webUrl(h.url) ? (
        <TextLink href={webUrl(h.url)} target="_blank" rel="noreferrer">
          {name}
        </TextLink>
      ) : (
        name
      )}
      {/* Two documents with the same title: the filename tells them apart. */}
      {duplicate && h.filename && h.filename !== name && <span className={s.muted}> · {h.filename}</span>}{" "}
      {h.expected && <Badge tone="success">Expected</Badge>}
    </>
  );
}

/** What the search returned, numbered 1-n: a document once, at its best passage (named when that isn't its row). */
function CameBack({ result: r }: { result: EvalResult }) {
  const titles = r.hits.map((h) => h.title);
  return (
    <div>
      <h3 className={e.columnTitle}>What came back</h3>
      {r.hits.length === 0 ? (
        <p className={s.muted}>Nothing came back.</p>
      ) : (
        <ol className={e.hits}>
          {r.hits.map((h, i) => (
            <li key={h.documentId}>
              <HitName hit={h} duplicate={titles.filter((t) => t === h.title).length > 1} />
              {h.rank !== i + 1 && <span className={s.muted}> · best passage #{h.rank}</span>}
              {h.snippet && <span className={e.snippet}>{plainSnippet(h.snippet)}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Scores({ result: r }: { result: EvalResult }) {
  const scores = r.scores!;
  return (
    <div className={e.scores} aria-label="Answer scores">
      <Badge tone={scores.cited ? "success" : "danger"}>{scores.cited ? "Cites an expected document" : "Doesn't cite an expected document"}</Badge>
      {scores.mentions.map((m) => (
        <Badge key={m.phrase} tone={m.found ? "success" : "danger"}>
          {m.found ? "Mentions" : "Doesn't mention"} “{m.phrase}”
        </Badge>
      ))}
      {citedOnly(r) && <Badge tone="info">Content not checked: no must-mention phrases</Badge>}
      {scores.refused && <Badge tone="warning">Refused</Badge>}
      {scores.supportedShare !== undefined && (
        <Badge tone="info">
          {legacyShare(scores) ? `${legacyShareLabel}: ${pct(scores.supportedShare)} of citations` : `${pct(scores.supportedShare)} of claims supported`}
        </Badge>
      )}
    </div>
  );
}

/** Expected beside What came back (retrieval), or the answer with its scores (full answers; the result page shows Expected in a card of its own). */
export function ResultDetail({ result: r }: { result: EvalResult }) {
  const answer = r.answer !== null && r.answer !== undefined;
  // Citations without a marker number (results stored by v0.2.0 beyond the answer's markers) are listed apart.
  const unnumbered = answer ? r.hits.filter((h) => h.n === undefined) : [];
  if (!answer)
    return (
      <div className={e.sideBySide}>
        <Expected result={r} />
        <CameBack result={r} />
      </div>
    );
  return (
    <div>
      {r.scores && <Scores result={r} />}
      <EvalAnswer result={r} />
      {unnumbered.length > 0 && (
        <>
          <p className={s.muted}>Cited documents:</p>
          <ul className={e.hits}>
            {unnumbered.map((h) => (
              <li key={h.documentId}>
                <HitName hit={h} duplicate={false} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
