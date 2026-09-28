/* One question's result: what came back (or was cited), and for full answers the answer and its scores. */
import { Badge } from "@/components/ui/badge/badge";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { pct } from "./labels";
import type { EvalResult } from "./queries";
import e from "./evaluations.module.css";

const webUrl = (u?: string) => (u && /^https?:\/\//.test(u) ? u : undefined);

/** "rank 2" or "not in the top results". */
export function rankText(r: Pick<EvalResult, "status" | "rank">) {
  if (r.status === "missing") return "Every expected document was deleted.";
  if (r.rank) return `Expected document at rank ${r.rank}.`;
  return r.status === "error" ? "" : "No expected document in the top results.";
}

export function ResultDetail({ result: r }: { result: EvalResult }) {
  const answer = r.answer !== null && r.answer !== undefined;
  return (
    <div>
      {r.error && <p className={s.dangerText}>{r.error}</p>}
      {!answer && <p>{rankText(r)}</p>}
      {r.hits.length > 0 && (
        <>
          <p className={s.muted}>{answer ? "Cited:" : "What came back:"}</p>
          <ol className={e.hits}>
            {r.hits.map((h) => (
              <li key={h.documentId} value={h.rank}>
                {webUrl(h.url) ? (
                  <TextLink href={webUrl(h.url)} target="_blank" rel="noreferrer">
                    {h.title || h.url}
                  </TextLink>
                ) : (
                  h.title || h.filename || "Untitled document"
                )}{" "}
                {h.expected && <Badge tone="success">Expected</Badge>}
              </li>
            ))}
          </ol>
        </>
      )}
      {answer && <p className={e.answer}>{r.answer || "(empty answer)"}</p>}
      {r.scores && (
        <div className={e.scores} aria-label="Answer scores">
          <Badge tone={r.scores.cited ? "success" : "danger"}>{r.scores.cited ? "Cites an expected document" : "Doesn't cite an expected document"}</Badge>
          {r.scores.mentions.map((m) => (
            <Badge key={m.phrase} tone={m.found ? "success" : "danger"}>
              {m.found ? "Mentions" : "Doesn't mention"} “{m.phrase}”
            </Badge>
          ))}
          {r.scores.refused && <Badge tone="warning">Refused</Badge>}
          {r.scores.supportedShare !== undefined && <Badge tone="info">{pct(r.scores.supportedShare)} of claims supported</Badge>}
        </div>
      )}
    </div>
  );
}
