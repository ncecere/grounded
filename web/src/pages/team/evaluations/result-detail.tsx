/* One question's result: what came back, or for full answers the answer with its citations and its scores. */
import { Badge } from "@/components/ui/badge/badge";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { EvalAnswer, webUrl } from "./answer";
import { pct } from "./labels";
import type { EvalResult } from "./queries";
import e from "./evaluations.module.css";

type Hit = EvalResult["hits"][number];

/** "Expected document at passage rank 2." or "No expected document in the top results." */
export function rankText(r: Pick<EvalResult, "status" | "rank">) {
  if (r.status === "missing") return "Every expected document was deleted.";
  if (r.rank) return `Expected document at passage rank ${r.rank}.`;
  return r.status === "error" ? "" : "No expected document in the top results.";
}

/** Why a question didn't pass, in a few words: the first failed score of a full answer ("Doesn't mention “fee”"), or "" when it passed. */
export function whyText(r: Pick<EvalResult, "status" | "rank" | "scores" | "error">) {
  if (r.status === "pass") return "";
  if (r.status === "error") return r.error || "The check failed.";
  const sc = r.scores;
  if (r.status === "missing" || !sc) return rankText(r);
  if (sc.refused) return "Refused to answer";
  if (!sc.cited) return "Doesn't cite an expected document";
  const missed = sc.mentions.find((m) => !m.found);
  return missed ? `Doesn't mention “${missed.phrase}”` : "";
}

/** The documents that came back, each once (the answer's citations can repeat one). */
export const hitTitles = (hits: Hit[]) => [...new Set(hits.map((h) => h.title || h.filename || h.url || "Untitled document"))].join(", ");

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

/** A retrieval's hits, numbered by passage rank: a document is listed once, at its best passage. */
function Retrieved({ result: r }: { result: EvalResult }) {
  const text = rankText(r);
  const titles = r.hits.map((h) => h.title);
  const gaps = r.hits.some((h, i) => h.rank !== i + 1);
  return (
    <>
      {text && <p>{text}</p>}
      {r.hits.length > 0 && (
        <>
          <p className={s.muted}>
            What came back, by passage rank{gaps ? ". Each document is listed once, at its best passage: the missing numbers are its other passages" : ""}:
          </p>
          <ol className={e.hits}>
            {r.hits.map((h) => (
              <li key={h.documentId} value={h.rank}>
                <HitName hit={h} duplicate={titles.filter((t) => t === h.title).length > 1} />
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function Scores({ scores }: { scores: NonNullable<EvalResult["scores"]> }) {
  return (
    <div className={e.scores} aria-label="Answer scores">
      <Badge tone={scores.cited ? "success" : "danger"}>{scores.cited ? "Cites an expected document" : "Doesn't cite an expected document"}</Badge>
      {scores.mentions.map((m) => (
        <Badge key={m.phrase} tone={m.found ? "success" : "danger"}>
          {m.found ? "Mentions" : "Doesn't mention"} “{m.phrase}”
        </Badge>
      ))}
      {scores.refused && <Badge tone="warning">Refused</Badge>}
      {scores.supportedShare !== undefined && <Badge tone="info">{pct(scores.supportedShare)} of claims supported</Badge>}
    </div>
  );
}

export function ResultDetail({ result: r }: { result: EvalResult }) {
  const answer = r.answer !== null && r.answer !== undefined;
  // Results stored before citations were kept per marker list the cited documents only.
  const legacy = answer && r.hits.length > 0 && r.hits.every((h) => h.n === undefined);
  return (
    <div>
      {r.error && <p className={s.dangerText}>{r.error}</p>}
      {!answer && <Retrieved result={r} />}
      {r.scores && <Scores scores={r.scores} />}
      {answer && <EvalAnswer result={r} />}
      {legacy && (
        <>
          <p className={s.muted}>Cited documents:</p>
          <ul className={e.hits}>
            {r.hits.map((h) => (
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
