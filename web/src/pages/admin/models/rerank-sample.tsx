/* "Test model" for a rerank model: the scores of a passage that answers the fixed question and one that doesn't. */
import type { Schemas } from "@/api/client";

const score = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 3 });

export function RerankSample({ test }: { test: Schemas["RerankModelTest"] }) {
  return (
    <span>
      “{test.query}” The answer scored {score(test.relevant)}; the unrelated passage {score(test.irrelevant)}.
    </span>
  );
}
