import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { ReasoningStep, ReasoningStepType, ReasoningStepStatus } from '../types';
import {
  BrainIcon,
  ChevronDownIcon,
  PencilIcon,
  ListTreeIcon,
  SearchIcon,
  GitMergeIcon,
  SparklesIcon,
  CheckCircleIcon,
  CircleIcon,
  AlertCircleIcon,
  LoaderIcon,
} from './Icons';

// =============================================================================
// Helper functions
// =============================================================================

/**
 * Get the icon component for a reasoning step type
 */
export function getStepIcon(type: ReasoningStepType): (props: { className?: string }) => JSX.Element {
  switch (type) {
    case 'rewrite':
      return PencilIcon;
    case 'plan':
      return ListTreeIcon;
    case 'search':
      return SearchIcon;
    case 'merge':
      return GitMergeIcon;
    case 'generate':
      return SparklesIcon;
    default:
      return BrainIcon;
  }
}

/**
 * Get the status icon for a reasoning step
 */
export function getStatusIcon(status: ReasoningStepStatus): (props: { className?: string }) => JSX.Element {
  switch (status) {
    case 'completed':
      return CheckCircleIcon;
    case 'in_progress':
      return LoaderIcon;
    case 'error':
      return AlertCircleIcon;
    case 'pending':
    default:
      return CircleIcon;
  }
}

/**
 * Get a human-readable label for the step type
 */
export function getStepTypeLabel(type: ReasoningStepType): string {
  switch (type) {
    case 'rewrite':
      return 'Query Rewriting';
    case 'plan':
      return 'Planning';
    case 'search':
      return 'Searching';
    case 'merge':
      return 'Merging';
    case 'generate':
      return 'Generating';
    default:
      return type;
  }
}

// =============================================================================
// ReasoningPanel Component
// =============================================================================

export interface ReasoningPanelProps {
  steps: ReasoningStep[];
  isStreaming?: boolean;
  defaultOpen?: boolean;
}

export function ReasoningPanel({
  steps,
  isStreaming = false,
  defaultOpen = false,
}: ReasoningPanelProps): JSX.Element | null {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Don't render if no steps
  if (steps.length === 0) {
    return null;
  }

  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const totalCount = steps.length;
  const hasInProgress = steps.some((s) => s.status === 'in_progress');

  const getMessage = () => {
    if (isStreaming || hasInProgress) {
      const currentStep = steps.find((s) => s.status === 'in_progress');
      if (currentStep) {
        return `${currentStep.title}...`;
      }
      return 'Processing...';
    }

    if (completedCount === totalCount && totalCount > 0) {
      return `Completed ${totalCount} reasoning steps`;
    }

    return `${completedCount}/${totalCount} steps completed`;
  };

  return (
    <div className={`grounded-reasoning-panel ${isStreaming ? 'streaming' : ''}`}>
      {/* Trigger/Header */}
      <button
        className={`grounded-reasoning-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <div className="grounded-reasoning-trigger-icon">
          <BrainIcon />
        </div>
        <span className="grounded-reasoning-trigger-text">
          {(isStreaming || hasInProgress) ? (
            <span className="grounded-reasoning-shimmer">{getMessage()}</span>
          ) : (
            getMessage()
          )}
        </span>
        <ChevronDownIcon className="grounded-reasoning-chevron" />
      </button>

      {/* Content */}
      {isOpen && (
        <div className="grounded-reasoning-content">
          <div className="grounded-reasoning-timeline">
            {steps.map((step, index) => (
              <ReasoningStepItem
                key={step.id}
                step={step}
                isLast={index === steps.length - 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ReasoningStepItem Component
// =============================================================================

interface ReasoningStepItemProps {
  step: ReasoningStep;
  isLast?: boolean;
}

function ReasoningStepItem({ step, isLast = false }: ReasoningStepItemProps): JSX.Element {
  const StepIcon = getStepIcon(step.type);
  const StatusIcon = getStatusIcon(step.status);
  const isInProgress = step.status === 'in_progress';
  const isCompleted = step.status === 'completed';
  const isError = step.status === 'error';

  return (
    <div className={`grounded-reasoning-step ${step.status} ${isLast ? 'last' : ''}`}>
      {/* Timeline dot */}
      <div className={`grounded-reasoning-step-dot ${step.status}`} />

      {/* Step icon */}
      <div className={`grounded-reasoning-step-icon ${step.status}`}>
        <StepIcon />
      </div>

      {/* Content */}
      <div className="grounded-reasoning-step-content">
        <div className="grounded-reasoning-step-title">
          {isInProgress ? (
            <span className="grounded-reasoning-shimmer">{step.title}</span>
          ) : (
            step.title
          )}
        </div>
        {step.summary && (
          <div className={`grounded-reasoning-step-summary ${step.status}`}>
            {step.summary}
          </div>
        )}
      </div>

      {/* Status icon */}
      <div className={`grounded-reasoning-step-status ${step.status}`}>
        {isInProgress ? (
          <LoaderIcon className="grounded-reasoning-spinner" />
        ) : (
          <StatusIcon />
        )}
      </div>
    </div>
  );
}

export default ReasoningPanel;
