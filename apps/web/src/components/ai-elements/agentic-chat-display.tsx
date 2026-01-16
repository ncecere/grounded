"use client";

import { cn } from "@/lib/utils";
import type { ChainOfThoughtStep } from "@/lib/api";
import {
  BrainIcon,
  ChevronDownIcon,
  SearchIcon,
  WrenchIcon,
  CheckCircleIcon,
  MessageSquareIcon,
  SparklesIcon,
  DatabaseIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { memo, useState, useEffect, useRef } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Loader } from "./loader";
import { CodeBlock } from "./code-block";

// ============================================================================
// Types
// ============================================================================

export type StreamingStatus =
  | "idle"
  | "thinking"
  | "searching"
  | "tool_call"
  | "generating"
  | "complete"
  | "error";

export interface AgenticStreamState {
  status: StreamingStatus;
  statusMessage?: string;
  currentToolName?: string;
  steps: ChainOfThoughtStep[];
  responseText: string;
  isStreaming: boolean;
  error?: string;
}

// ============================================================================
// Step Icon Component
// ============================================================================

const StepIcon = memo(
  ({
    type,
    isActive,
  }: {
    type: ChainOfThoughtStep["type"];
    isActive: boolean;
  }) => {
    const iconClass = cn(
      "size-4 shrink-0",
      isActive ? "text-primary" : "text-muted-foreground"
    );

    switch (type) {
      case "thinking":
        return <BrainIcon className={iconClass} />;
      case "searching":
        return <SearchIcon className={iconClass} />;
      case "tool_call":
        return <WrenchIcon className={iconClass} />;
      case "tool_result":
        return <CheckCircleIcon className={iconClass} />;
      case "answering":
        return <MessageSquareIcon className={iconClass} />;
      default:
        return <SparklesIcon className={iconClass} />;
    }
  }
);

StepIcon.displayName = "StepIcon";

// ============================================================================
// Step Content Component
// ============================================================================

interface StepContentProps {
  step: ChainOfThoughtStep;
  isActive: boolean;
  isLast: boolean;
}

const StepContent = memo(({ step, isActive, isLast }: StepContentProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStepLabel = () => {
    switch (step.type) {
      case "thinking":
        return "Analyzing query...";
      case "searching":
        return step.kbName
          ? `Searching "${step.kbName}"`
          : "Searching knowledge base";
      case "tool_call":
        return `Calling ${step.toolName || "tool"}`;
      case "tool_result":
        return `${step.toolName || "Tool"} completed`;
      case "answering":
        return "Generating response";
      default:
        return step.content;
    }
  };

  const hasDetails =
    step.toolArgs ||
    step.toolResult ||
    (step.content && step.type !== "thinking");

  return (
    <div
      className={cn(
        "flex gap-3 py-2",
        "animate-in fade-in-0 slide-in-from-top-1 duration-200"
      )}
    >
      {/* Timeline indicator */}
      <div className="relative flex flex-col items-center">
        <div
          className={cn(
            "flex size-6 items-center justify-center rounded-full border",
            isActive
              ? "border-primary bg-primary/10"
              : "border-border bg-background"
          )}
        >
          {isActive ? (
            <Loader size={12} className="text-primary" />
          ) : (
            <StepIcon type={step.type} isActive={false} />
          )}
        </div>
        {!isLast && (
          <div className="absolute top-6 h-full w-px bg-border" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm font-medium",
              isActive ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {getStepLabel()}
          </span>
          {step.kbId && (
            <Badge variant="secondary" className="text-xs">
              <DatabaseIcon className="mr-1 size-3" />
              KB
            </Badge>
          )}
          {isActive && (
            <Badge variant="outline" className="text-xs animate-pulse">
              In progress
            </Badge>
          )}
        </div>

        {/* Expandable details for tool calls */}
        {hasDetails && !isActive && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDownIcon
                className={cn(
                  "size-3 transition-transform",
                  isExpanded && "rotate-180"
                )}
              />
              {isExpanded ? "Hide details" : "Show details"}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              {step.toolArgs && (
                <div className="rounded-md border bg-muted/30 overflow-hidden">
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b bg-muted/50">
                    Input
                  </div>
                  <CodeBlock
                    code={JSON.stringify(step.toolArgs, null, 2)}
                    language="json"
                  />
                </div>
              )}
              {step.toolResult !== undefined && (
                <div className="rounded-md border bg-muted/30 overflow-hidden">
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b bg-muted/50">
                    Output
                  </div>
                  <CodeBlock
                    code={
                      typeof step.toolResult === "string"
                        ? step.toolResult
                        : JSON.stringify(step.toolResult as Record<string, unknown>, null, 2)
                    }
                    language="json"
                  />
                </div>
              )}
              {step.content && step.type !== "thinking" && (
                <p className="text-xs text-muted-foreground">{step.content}</p>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Show brief preview when collapsed */}
        {step.content && step.type === "thinking" && !isActive && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
            {step.content}
          </p>
        )}
      </div>
    </div>
  );
});

StepContent.displayName = "StepContent";

// ============================================================================
// Main AgenticChatDisplay Component
// ============================================================================

export interface AgenticChatDisplayProps extends ComponentProps<"div"> {
  state: AgenticStreamState;
  showChainOfThought?: boolean;
  defaultExpanded?: boolean;
}

export const AgenticChatDisplay = memo(
  ({
    className,
    state,
    showChainOfThought = true,
    defaultExpanded = true,
    ...props
  }: AgenticChatDisplayProps) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const stepsContainerRef = useRef<HTMLDivElement>(null);

    // Auto-expand when streaming starts, auto-collapse after done (after delay)
    useEffect(() => {
      if (state.isStreaming && state.steps.length > 0) {
        setIsExpanded(true);
      }
    }, [state.isStreaming, state.steps.length]);

    // Auto-collapse 2s after completion
    useEffect(() => {
      if (state.status === "complete" && isExpanded && state.steps.length > 0) {
        const timer = setTimeout(() => {
          setIsExpanded(false);
        }, 2000);
        return () => clearTimeout(timer);
      }
    }, [state.status, isExpanded, state.steps.length]);

    // Auto-scroll to latest step
    useEffect(() => {
      if (stepsContainerRef.current && state.isStreaming) {
        stepsContainerRef.current.scrollTop =
          stepsContainerRef.current.scrollHeight;
      }
    }, [state.steps, state.isStreaming]);

    if (!showChainOfThought || state.steps.length === 0) {
      return null;
    }

    const getHeaderText = (): ReactNode => {
      if (state.isStreaming) {
        switch (state.status) {
          case "thinking":
            return (
              <span className="flex items-center gap-2">
                <Loader size={14} />
                Thinking...
              </span>
            );
          case "searching":
            return (
              <span className="flex items-center gap-2">
                <Loader size={14} />
                {state.statusMessage || "Searching knowledge base..."}
              </span>
            );
          case "tool_call":
            return (
              <span className="flex items-center gap-2">
                <Loader size={14} />
                {state.currentToolName
                  ? `Using ${state.currentToolName}...`
                  : "Executing tool..."}
              </span>
            );
          case "generating":
            return (
              <span className="flex items-center gap-2">
                <Loader size={14} />
                Generating response...
              </span>
            );
          default:
            return (
              <span className="flex items-center gap-2">
                <Loader size={14} />
                Processing...
              </span>
            );
        }
      }

      const toolCalls = state.steps.filter((s) => s.type === "tool_call").length;
      const searches = state.steps.filter((s) => s.type === "searching").length;

      if (toolCalls > 0 || searches > 0) {
        const parts: string[] = [];
        if (searches > 0) parts.push(`${searches} search${searches > 1 ? "es" : ""}`);
        if (toolCalls > 0) parts.push(`${toolCalls} tool${toolCalls > 1 ? "s" : ""}`);
        return `Used ${parts.join(" and ")}`;
      }

      return "Chain of thought";
    };

    return (
      <div className={cn("not-prose", className)} {...props}>
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleTrigger
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm",
              "bg-muted/50 hover:bg-muted transition-colors",
              "text-muted-foreground hover:text-foreground"
            )}
          >
            <BrainIcon className="size-4 shrink-0" />
            <span className="flex-1 text-left">{getHeaderText()}</span>
            <ChevronDownIcon
              className={cn(
                "size-4 shrink-0 transition-transform",
                isExpanded && "rotate-180"
              )}
            />
          </CollapsibleTrigger>

          <CollapsibleContent
            className={cn(
              "mt-2 rounded-lg border bg-card p-3",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2"
            )}
          >
            <div
              ref={stepsContainerRef}
              className="max-h-80 overflow-y-auto scrollbar-thin"
            >
              {state.steps.map((step, index) => {
                const isLast = index === state.steps.length - 1;
                const isActive = isLast && state.isStreaming;

                return (
                  <StepContent
                    key={`${step.type}-${step.timestamp}`}
                    step={step}
                    isActive={isActive}
                    isLast={isLast}
                  />
                );
              })}
            </div>

            {state.error && (
              <div className="mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {state.error}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }
);

AgenticChatDisplay.displayName = "AgenticChatDisplay";

// ============================================================================
// Compact Status Indicator (for inline use)
// ============================================================================

export interface AgenticStatusIndicatorProps extends ComponentProps<"div"> {
  status: StreamingStatus;
  message?: string;
  toolName?: string;
}

export const AgenticStatusIndicator = memo(
  ({
    className,
    status,
    message,
    toolName,
    ...props
  }: AgenticStatusIndicatorProps) => {
    if (status === "idle" || status === "complete") {
      return null;
    }

    const getContent = () => {
      switch (status) {
        case "thinking":
          return (
            <>
              <BrainIcon className="size-3" />
              <span>Thinking...</span>
            </>
          );
        case "searching":
          return (
            <>
              <SearchIcon className="size-3" />
              <span>{message || "Searching..."}</span>
            </>
          );
        case "tool_call":
          return (
            <>
              <WrenchIcon className="size-3" />
              <span>{toolName ? `Using ${toolName}` : "Executing tool..."}</span>
            </>
          );
        case "generating":
          return (
            <>
              <MessageSquareIcon className="size-3" />
              <span>Generating response...</span>
            </>
          );
        case "error":
          return (
            <>
              <span className="text-destructive">{message || "Error occurred"}</span>
            </>
          );
        default:
          return <span>Processing...</span>;
      }
    };

    return (
      <div
        className={cn(
          "flex items-center gap-2 text-xs text-muted-foreground",
          "animate-in fade-in-0 duration-200",
          status === "error" && "text-destructive",
          className
        )}
        {...props}
      >
        {status !== "error" && <Loader size={12} />}
        {getContent()}
      </div>
    );
  }
);

AgenticStatusIndicator.displayName = "AgenticStatusIndicator";
