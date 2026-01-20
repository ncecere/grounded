import { StatusBadge } from "../ui/status-badge";
import type { CheckResult } from "../../lib/api";

const CHECK_LABELS: Record<CheckResult["checkType"], string> = {
  contains_phrases: "Contains phrases",
  semantic_similarity: "Semantic similarity",
  llm_judge: "LLM judge",
};

const formatSimilarityPercent = (value?: number) => {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  return `${Math.round(value * 100)}%`;
};

export const getCheckResultLabel = (check: CheckResult) => CHECK_LABELS[check.checkType];

export const formatCheckResultSummary = (check: CheckResult) => {
  switch (check.checkType) {
    case "contains_phrases": {
      const matched = check.details.matchedPhrases?.length ?? 0;
      const missing = check.details.missingPhrases?.length ?? 0;
      const total = matched + missing;
      if (total > 0) {
        return `${matched}/${total} phrases matched`;
      }
      return "Phrase match check";
    }
    case "semantic_similarity": {
      const score = formatSimilarityPercent(check.details.similarityScore);
      const threshold = formatSimilarityPercent(check.details.threshold);
      if (score && threshold) {
        return `Similarity ${score} · Threshold ${threshold}`;
      }
      if (score) {
        return `Similarity ${score}`;
      }
      return "Semantic similarity check";
    }
    case "llm_judge": {
      if (check.details.judgement) {
        return `Judgement: ${check.details.judgement}`;
      }
      return "LLM judge evaluation";
    }
    default:
      return "Check result";
  }
};

export const formatCheckResultDetail = (check: CheckResult) => {
  switch (check.checkType) {
    case "contains_phrases": {
      if (check.details.missingPhrases && check.details.missingPhrases.length > 0) {
        return `Missing: ${check.details.missingPhrases.join(", ")}`;
      }
      if (check.details.matchedPhrases && check.details.matchedPhrases.length > 0) {
        return `Matched: ${check.details.matchedPhrases.join(", ")}`;
      }
      return null;
    }
    case "semantic_similarity": {
      const score = formatSimilarityPercent(check.details.similarityScore);
      const threshold = formatSimilarityPercent(check.details.threshold);
      if (score && threshold) {
        return `Score ${score} vs threshold ${threshold}`;
      }
      return null;
    }
    case "llm_judge": {
      if (check.details.reasoning) {
        return check.details.reasoning;
      }
      return null;
    }
    default:
      return null;
  }
};

interface CheckResultDisplayProps {
  check: CheckResult;
}

export function CheckResultDisplay({ check }: CheckResultDisplayProps) {
  const summary = formatCheckResultSummary(check);
  const detail = formatCheckResultDetail(check);
  const label = getCheckResultLabel(check);

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          {summary && <p className="text-xs text-muted-foreground mt-1">{summary}</p>}
        </div>
        <StatusBadge
          status={check.passed ? "success" : "error"}
          label={check.passed ? "Passed" : "Failed"}
        />
      </div>
      {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
