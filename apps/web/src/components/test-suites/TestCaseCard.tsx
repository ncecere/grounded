import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { StatusBadge, type StatusType } from "../ui/status-badge";
import type { ExpectedBehavior, TestCase, TestCaseResultSummary } from "../../lib/api";

const CHECK_LABELS: Record<string, string> = {
  contains_phrases: "Contains",
  semantic_similarity: "Semantic",
  llm_judge: "LLM Judge",
};

export const getCheckBadges = (expectedBehavior: ExpectedBehavior) => {
  const counts = expectedBehavior.checks.reduce<Record<string, number>>((acc, check) => {
    acc[check.type] = (acc[check.type] ?? 0) + 1;
    return acc;
  }, {});

  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return [{ label: "No checks", variant: "outline" as const }];
  }

  return entries.map(([type, count]) => ({
    label: `${CHECK_LABELS[type] ?? "Check"}${count > 1 ? ` x${count}` : ""}`,
    variant: "secondary" as const,
  }));
};

export const getLastResultBadge = (
  lastResult: TestCaseResultSummary | null
): { status: StatusType; label: string } => {
  if (!lastResult) {
    return { status: "default", label: "No results" };
  }

  switch (lastResult.status) {
    case "passed":
      return { status: "success", label: "Passed" };
    case "failed":
      return { status: "error", label: "Failed" };
    case "skipped":
      return { status: "warning", label: "Skipped" };
    case "error":
      return { status: "error", label: "Error" };
    default:
      return { status: "default", label: "Unknown" };
  }
};

export const getLastResultTimestampLabel = (lastResult: TestCaseResultSummary | null) => {
  if (!lastResult) {
    return "Never run";
  }

  return `Last run ${new Date(lastResult.createdAt).toLocaleDateString("en-US")}`;
};

interface TestCaseCardProps {
  testCase: TestCase;
  onEdit: (testCase: TestCase) => void;
  onDelete: (testCase: TestCase) => void;
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  dragItemProps?: HTMLAttributes<HTMLDivElement>;
  isDragging?: boolean;
}

export function TestCaseCard({
  testCase,
  onEdit,
  onDelete,
  dragHandleProps,
  dragItemProps,
  isDragging = false,
}: TestCaseCardProps) {
  const badge = getLastResultBadge(testCase.lastResult);
  const timestampLabel = getLastResultTimestampLabel(testCase.lastResult);
  const checkBadges = getCheckBadges(testCase.expectedBehavior);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-sm",
        isDragging && "opacity-60"
      )}
      {...dragItemProps}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <button
            type="button"
            className="mt-1 text-muted-foreground hover:text-foreground"
            aria-label="Drag to reorder"
            {...dragHandleProps}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground truncate">{testCase.name}</h4>
              {!testCase.isEnabled && (
                <Badge variant="outline" className="text-muted-foreground">
                  Disabled
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {testCase.question}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => onEdit(testCase)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(testCase)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {testCase.description && (
        <p className="mt-3 text-xs text-muted-foreground line-clamp-2">{testCase.description}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {checkBadges.map((item) => (
          <Badge key={item.label} variant={item.variant}>
            {item.label}
          </Badge>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>{timestampLabel}</span>
        <StatusBadge status={badge.status} label={badge.label} />
      </div>
    </div>
  );
}
