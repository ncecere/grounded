import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "../ui/empty-state";
import { LoadingSkeleton } from "../ui/loading-skeleton";
import type { TestSuite } from "../../lib/api";
import { TestSuiteCard } from "./TestSuiteCard";

export const DEFAULT_EMPTY_STATE = {
  title: "No test suites yet",
  description: "Create a test suite to validate agent responses.",
};

interface TestSuiteListProps {
  suites?: TestSuite[];
  isLoading?: boolean;
  onOpen: (suite: TestSuite) => void;
  onRun: (suite: TestSuite) => void;
  onEdit: (suite: TestSuite) => void;
  onDelete: (suite: TestSuite) => void;
  onView?: (suite: TestSuite) => void;
  emptyStateAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function TestSuiteList({
  suites,
  isLoading,
  onOpen,
  onRun,
  onEdit,
  onDelete,
  onView,
  emptyStateAction,
  className,
}: TestSuiteListProps) {
  if (isLoading) {
    return <LoadingSkeleton variant="card" count={3} className={className} />;
  }

  if (!suites || suites.length === 0) {
    return (
      <EmptyState
        icon={FlaskConical}
        title={DEFAULT_EMPTY_STATE.title}
        description={DEFAULT_EMPTY_STATE.description}
        action={emptyStateAction}
        className={className}
      />
    );
  }

  return (
    <div className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", className)}>
      {suites.map((suite) => (
        <TestSuiteCard
          key={suite.id}
          suite={suite}
          onOpen={onOpen}
          onRun={onRun}
          onEdit={onEdit}
          onDelete={onDelete}
          onView={onView}
        />
      ))}
    </div>
  );
}
