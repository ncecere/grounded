/*
 * A document's possible personal data (docs/pii-scanning.md): what was found (kind, count, pages; never the text), and the
 * editor's review. A flagged document is indexed: Dismiss keeps it as it is, or the editor deletes it. A held one is not
 * indexed: Approve queues it for indexing. A review lasts while what is found stays the same.
 */
import { Check, ShieldCheck } from "lucide-react";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Time } from "@/components/ui/time/time";
import { awaitingReview, findingText, piiStateLabel, type DocumentPii } from "@/lib/pii";
import type { Doc } from "../common";
import type { DocumentMutations } from "./mutations";
import d from "./documents.module.css";

const stateTone = { flagged: "warning", held: "warning", dismissed: "neutral", approved: "success" } as const;

const stateText: Record<DocumentPii["state"], string> = {
  flagged: "It is indexed and can appear in answers. Check it, then dismiss the flag if it belongs in this source, or delete it.",
  held: "It is not indexed, so it can't appear in answers, because its source's classification holds documents like this for review. Approve it to index it, or delete it.",
  dismissed: "An editor reviewed it and kept it. It is reviewed again if a new version finds something different.",
  approved: "An editor approved it for indexing. It is reviewed again if a new version finds something different.",
};

/** The badge the documents table shows next to the status of a document waiting for a review. */
export function PiiBadge({ pii }: { pii: Doc["pii"] }) {
  if (!awaitingReview(pii)) return null;
  return <StatusBadge tone="warning">Needs review</StatusBadge>;
}

export function PiiReview({ doc, mutations, canEdit }: { doc: Doc; mutations: DocumentMutations; canEdit: boolean }) {
  const pii = doc.pii;
  if (!pii) return null;
  const review = mutations.reviewPii;
  return (
    <div className={d.problems}>
      <p>
        <StatusBadge tone={stateTone[pii.state]}>{piiStateLabel[pii.state]}</StatusBadge>
      </p>
      <p>{stateText[pii.state]}</p>
      <ul className={d.warnings} aria-label="What was found">
        {pii.findings.map((f) => (
          <li key={f.kind}>{findingText(f)}</li>
        ))}
      </ul>
      <p className={d.muted}>Grounded records only the kind of data, how many and where. The matches themselves are never stored or shown.</p>
      {pii.reviewedAt && (
        <p className={d.muted}>
          Reviewed <Time value={pii.reviewedAt} format="datetime" />
        </p>
      )}
      {canEdit && awaitingReview(pii) && (
        <div>
          {pii.state === "flagged" ? (
            <Button variant="secondary" loading={review.isPending} onClick={() => review.mutate({ doc, action: "dismiss" })}>
              <Check aria-hidden /> Dismiss flag
            </Button>
          ) : (
            <Button loading={review.isPending} onClick={() => review.mutate({ doc, action: "approve" })}>
              <ShieldCheck aria-hidden /> Approve and index
            </Button>
          )}
        </div>
      )}
      <ErrorAlert error={review.error} />
    </div>
  );
}
