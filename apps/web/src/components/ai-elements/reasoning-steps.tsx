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
  ReasoningStepStatus,
  ReasoningStepType,
} from "@/lib/api/types/chat";

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
          className={cn(
            "not-prose reasoning-panel rounded-lg border border-border/50 bg-muted/30 px-3 py-2",
            isStreaming && "reasoning-panel-streaming",
            className
          )}
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
          "reasoning-trigger flex w-full items-center gap-2.5 py-1 text-sm transition-colors",
          "text-muted-foreground hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 rounded",
          className
        )}
        {...props}
      >
        <div className="reasoning-trigger-icon flex size-6 items-center justify-center rounded-md bg-primary/10">
          <BrainIcon className="size-3.5 text-primary" />
        </div>
        <span className="flex-1 text-left font-medium">{getMessage()}</span>
        <ChevronDownIcon
          className={cn(
            "size-4 transition-transform duration-200",
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
        "reasoning-content mt-3 text-sm",
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-hidden data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...props}
    >
      <div className="reasoning-timeline relative space-y-1 border-l-2 border-primary/20 pl-4 ml-3">
        {steps.map((step, index) => (
          <ReasoningStepItem
            key={step.id}
            step={step}
            className={index === steps.length - 1 ? "pb-0" : ""}
          />
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
    const isCompleted = step.status === "completed";

    return (
      <div
        className={cn(
          "reasoning-step relative flex items-start gap-3 py-1.5",
          isInProgress && "reasoning-step-active",
          className
        )}
      >
        {/* Timeline dot indicator */}
        <div
          className={cn(
            "reasoning-step-dot absolute -left-[21px] top-2.5 size-2 rounded-full border-2 border-background",
            isCompleted && "bg-green-500",
            isInProgress && "bg-primary animate-pulse",
            step.status === "pending" && "bg-muted-foreground/30",
            step.status === "error" && "bg-destructive"
          )}
        />

        {/* Step type icon */}
        <div
          className={cn(
            "reasoning-step-icon flex size-7 flex-shrink-0 items-center justify-center rounded-md transition-colors",
            isInProgress && "bg-primary/10",
            isCompleted && "bg-green-500/10",
            step.status === "pending" && "bg-muted",
            step.status === "error" && "bg-destructive/10"
          )}
        >
          <StepIcon
            className={cn(
              "size-3.5",
              isInProgress && "text-primary",
              isCompleted && "text-green-600 dark:text-green-500",
              step.status === "pending" && "text-muted-foreground",
              step.status === "error" && "text-destructive"
            )}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-medium text-sm leading-tight",
                isInProgress && "text-foreground",
                isCompleted && "text-foreground/80",
                step.status === "pending" && "text-muted-foreground",
                step.status === "error" && "text-destructive"
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
                "text-xs mt-0.5 leading-relaxed",
                isInProgress && "text-muted-foreground",
                isCompleted && "text-muted-foreground/70",
                step.status === "pending" && "text-muted-foreground/60",
                step.status === "error" && "text-destructive/80"
              )}
            >
              {step.summary}
            </p>
          )}
        </div>

        {/* Status icon */}
        <div
          className={cn(
            "reasoning-step-status flex-shrink-0 mt-1",
            statusClasses
          )}
        >
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
