/* "Test model" for a SystemOne model: the fixed yes/no and score questions and their answers. */
import type { Schemas } from "@/api/client";
import { pct } from "@/lib/systemone";

export function SystemOneSample({ test }: { test: Schemas["SystemOneModelTest"] }) {
  const level = test.scoreLevels[Math.round(test.score)] ?? "";
  return (
    <span>
      “{test.noulQuestion}” yes {pct(test.noul)}. “{test.scoreQuestion}” {test.score.toFixed(2)} of {test.scoreLevels.length - 1} ({level.toLowerCase()}).
    </span>
  );
}
