/* Normalised moderation scores: a table per result, and the benign/harmful summary of "Test model". */
import type { CSSProperties } from "react";
import type { Schemas } from "@/api/client";
import { Badge } from "@/components/ui/badge/badge";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { categoryLabel, percent, topScore, type ModerationResult } from "@/lib/moderation";
import s from "../../shared.module.css";
import md from "./moderation.module.css";

/** Calibrated results have real probabilities; label-only ones are 0 or 100%. */
export function CalibrationBadge({ calibrated }: { calibrated: boolean }) {
  return calibrated ? <Badge tone="success">Calibrated</Badge> : <Badge tone="warning">Not calibrated</Badge>;
}

export function ScoreTable({ result, caption }: { result: ModerationResult; caption: string }) {
  return (
    <Table caption={caption} columns={["Category", { label: "Probability", width: "60%" }]}>
      {result.scores.map((sc) => (
        <Tr key={sc.category}>
          <Td>{categoryLabel(sc.category)}</Td>
          <Td>
            {sc.supported ? (
              <span className={md.score}>
                <span className={md.bar} aria-hidden data-high={sc.probability >= 0.5 ? "" : undefined}>
                  <span className={md.fill} style={{ "--score": percent(sc.probability) } as CSSProperties} />
                </span>
                <span className={md.scoreValue}>{percent(sc.probability)}</span>
              </span>
            ) : (
              <span className={s.muted}>Not supported by this provider</span>
            )}
          </Td>
        </Tr>
      ))}
    </Table>
  );
}

const summary = (r: ModerationResult) => {
  const top = topScore(r);
  return top ? `highest ${categoryLabel(top.category)} ${percent(top.probability)}` : "no supported categories";
};

/** The "Test model" outcome of a moderation model. */
export function ModerationSamples({ test }: { test: Schemas["ModerationModelTest"] }) {
  return (
    <span className={md.samples}>
      <span>
        Benign sample: {summary(test.benign)}. Harmful sample: {summary(test.harmful)}.
      </span>
      <CalibrationBadge calibrated={test.harmful.calibrated} />
    </span>
  );
}
