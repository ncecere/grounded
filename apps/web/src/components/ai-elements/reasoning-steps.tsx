"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  BrainIcon,
  ChevronDownIcon,
  PencilIcon,
  ListTreeIcon,
  SearchIcon,
  GitMergeIcon,
  SparklesIcon,
  CheckCircle2Icon,
  CircleIcon,
  AlertCircleIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { memo, createContext, useContext } from "react";
import { Shimmer } from "./shimmer";
import { Loader } from "./loader";
import type {
  ReasoningStep,
  ReasoningStepType,
  ReasoningStepStatus,
} from "@/lib/api/types";

// =============================================================================
// Context
// =============================================================================

type ReasoningStepsContextValue = {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isStreaming: boolean;
};

const ReasoningStepsContext = createContext<ReasoningStepsContextValue | null>(
  null
);

export const useReasoningSteps = () => {
  const context = useContext(ReasoningStepsContext);
  if (!context) {
    throw new Error(
      "ReasoningSteps components must be used within ReasoningSteps"
    );
  }
  return context;
};

// =============================================================================
// Helper functions
// =============================================================================

/**
 * Get the icon component for a reasoning step type
 */
export function getStepIcon(type: ReasoningStepType) {
  switch (type) {
    case "rewrite":
      return PencilIcon;
    case "plan":
      return ListTreeIcon;
    case "search":
      return SearchIcon;
    case "merge":
      return GitMergeIcon;
    case "generate":
      return SparklesIcon;
    default:
      return BrainIcon;
  }
}

/**
 * Get the status icon for a reasoning step
 */
export function getStatusIcon(status: ReasoningStepStatus) {
  switch (status) {
    case "completed":
      return CheckCircle2Icon;
    case "in_progress":
      return Loader;
    case "error":
      return AlertCircleIcon;
    case "pending":
    default:
      return CircleIcon;
  }
}

/**
 * Get status-specific styling classes
 */
export function getStatusClasses(status: ReasoningStepStatus): string {
  switch (status) {
    case "completed":
      return "text-green-600 dark:text-green-500";
    case "in_progress":
      return "text-primary";
    case "error":
      return "text-destructive";
    case "pending":
    default:
      return "text-muted-foreground";
  }
}

/**
 * Get a human-readable label for the step type
 */
export function getStepTypeLabel(type: ReasoningStepType): string {
  switch (type) {
    case "rewrite":
      return "Query Rewriting";
    case "plan":
      return "Planning";
    case "search":
      return "Searching";
    case "merge":
      return "Merging";
    case "generate":
      return "Generating";
    default:
      return type;
  }
}

// =============================================================================
// ReasoningSteps Container
// =============================================================================

export type ReasoningStepsProps = ComponentProps<typeof Collapsible> & {
  steps: ReasoningStep[];
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const ReasoningSteps = memo(
  ({
    className,
    steps,
    isStreaming = false,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ReasoningStepsProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    });

    const handleOpenChange = (newOpen: boolean) => {
      setIsOpen(newOpen);
    };

    // Don't render if no steps
    if (steps.length === 0) {
      return null;
    }

    return (
      <ReasoningStepsContext.Provider
        value={{ isOpen, setIsOpen, isStreaming }}
      >
        <Collapsible
          className={cn("not-prose mb-4", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningStepsContext.Provider>
    );
  }
);

// =============================================================================
// ReasoningStepsTrigger
// =============================================================================

export type ReasoningStepsTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  steps: ReasoningStep[];
};

export const ReasoningStepsTrigger = memo(
  ({ className, steps, ...props }: ReasoningStepsTriggerProps) => {
    const { isOpen, isStreaming } = useReasoningSteps();

    const completedCount = steps.filter((s) => s.status === "completed").length;
    const totalCount = steps.length;
    const hasInProgress = steps.some((s) => s.status === "in_progress");

    const getMessage = () => {
      if (isStreaming || hasInProgress) {
        const currentStep = steps.find((s) => s.status === "in_progress");
        if (currentStep) {
          return (
            <Shimmer duration={1}>{`${currentStep.title}...`}</Shimmer>
          );
        }
        return <Shimmer duration={1}>Processing...</Shimmer>;
      }

      if (completedCount === totalCount && totalCount > 0) {
        return `Completed ${totalCount} reasoning steps`;
      }

      return `${completedCount}/${totalCount} steps completed`;
    };

    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground",
          className
        )}
        {...props}
      >
        <BrainIcon className="size-4" />
        <span className="flex-1 text-left">{getMessage()}</span>
        <ChevronDownIcon
          className={cn(
            "size-4 transition-transform",
            isOpen ? "rotate-180" : "rotate-0"
          )}
        />
      </CollapsibleTrigger>
    );
  }
);

// =============================================================================
// ReasoningStepsContent
// =============================================================================

export type ReasoningStepsContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  steps: ReasoningStep[];
};

export const ReasoningStepsContent = memo(
  ({ className, steps, ...props }: ReasoningStepsContentProps) => (
    <CollapsibleContent
      className={cn(
        "mt-3 text-sm",
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-hidden data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...props}
    >
      <div className="space-y-2 border-l-2 border-muted pl-4">
        {steps.map((step) => (
          <ReasoningStepItem key={step.id} step={step} />
        ))}
      </div>
    </CollapsibleContent>
  )
);

// =============================================================================
// ReasoningStepItem (individual step display)
// =============================================================================

export type ReasoningStepItemProps = {
  step: ReasoningStep;
  className?: string;
};

export const ReasoningStepItem = memo(
  ({ step, className }: ReasoningStepItemProps) => {
    const StepIcon = getStepIcon(step.type);
    const StatusIcon = getStatusIcon(step.status);
    const statusClasses = getStatusClasses(step.status);
    const isInProgress = step.status === "in_progress";

    return (
      <div className={cn("flex items-start gap-3 py-1", className)}>
        {/* Step type icon */}
        <div className="flex-shrink-0 mt-0.5">
          <StepIcon className="size-4 text-muted-foreground" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-medium text-sm",
                isInProgress ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {isInProgress ? (
                <Shimmer duration={1}>{step.title}</Shimmer>
              ) : (
                step.title
              )}
            </span>
          </div>
          {step.summary && (
            <p
              className={cn(
                "text-xs mt-0.5",
                isInProgress
                  ? "text-muted-foreground"
                  : "text-muted-foreground/80"
              )}
            >
              {step.summary}
            </p>
          )}
        </div>

        {/* Status icon */}
        <div className={cn("flex-shrink-0 mt-0.5", statusClasses)}>
          {step.status === "in_progress" ? (
            <Loader size={14} />
          ) : (
            <StatusIcon className="size-3.5" />
          )}
        </div>
      </div>
    );
  }
);

// Display names
ReasoningSteps.displayName = "ReasoningSteps";
ReasoningStepsTrigger.displayName = "ReasoningStepsTrigger";
ReasoningStepsContent.displayName = "ReasoningStepsContent";
ReasoningStepItem.displayName = "ReasoningStepItem";
