import type { JSX } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import type { ChainOfThoughtStep } from '../types';
import type { ChatStatus } from '../hooks/useChat';

// Inline SVG icons for the widget (to avoid additional dependencies)
const BrainIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>
    <path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>
    <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>
    <path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>
    <path d="M19.938 10.5a4 4 0 0 1 .585.396"/>
    <path d="M6 18a4 4 0 0 1-1.967-.516"/>
    <path d="M19.967 17.484A4 4 0 0 1 18 18"/>
  </svg>
);

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <path d="m21 21-4.3-4.3"/>
  </svg>
);

const WrenchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <path d="m9 11 3 3L22 4"/>
  </svg>
);

const MessageIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
  </svg>
);

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg 
    width="12" 
    height="12" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
    style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
  >
    <path d="m6 9 6 6 6-6"/>
  </svg>
);

const LoadingSpinner = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="grounded-agentic-spinner">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);

interface AgenticStepsProps {
  steps: ChainOfThoughtStep[];
  status: ChatStatus;
  isStreaming: boolean;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
}

export function AgenticSteps({ steps, status, isStreaming, isExpanded: controlledExpanded, onToggleExpanded }: AgenticStepsProps): JSX.Element | null {
  // Use controlled state if provided, otherwise use internal state
  const [internalExpanded, setInternalExpanded] = useState(true);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  
  const handleToggle = () => {
    if (onToggleExpanded) {
      onToggleExpanded();
    } else {
      setInternalExpanded(!internalExpanded);
    }
  };

  // Don't render if no steps and not actively processing
  if (steps.length === 0 && status.status === 'idle') {
    return null;
  }

  const getStepIcon = (type: ChainOfThoughtStep['type'], isActive: boolean) => {
    if (isActive) {
      return <LoadingSpinner />;
    }
    switch (type) {
      case 'thinking':
        return <BrainIcon />;
      case 'searching':
        return <SearchIcon />;
      case 'tool_call':
        return <WrenchIcon />;
      case 'tool_result':
        return <CheckIcon />;
      case 'answering':
        return <MessageIcon />;
      default:
        return <BrainIcon />;
    }
  };

  const getStepLabel = (step: ChainOfThoughtStep) => {
    switch (step.type) {
      case 'thinking':
        return 'Analyzing...';
      case 'searching':
        return step.kbName ? `Searching "${step.kbName}"` : 'Searching';
      case 'tool_call':
        return step.toolName ? `Using ${step.toolName}` : 'Using tool';
      case 'tool_result':
        return step.toolName ? `${step.toolName} done` : 'Completed';
      case 'answering':
        return 'Responding';
      default:
        return 'Processing';
    }
  };

  const getHeaderText = () => {
    if (isStreaming && status.status !== 'idle' && status.status !== 'streaming') {
      switch (status.status) {
        case 'thinking':
          return 'Thinking...';
        case 'searching':
          return status.message || 'Searching...';
        case 'tool_call':
          return status.toolName ? `Using ${status.toolName}...` : 'Using tool...';
        case 'generating':
          return 'Generating...';
        default:
          return 'Processing...';
      }
    }

    const toolCalls = steps.filter(s => s.type === 'tool_call').length;
    const searches = steps.filter(s => s.type === 'searching').length;

    if (toolCalls > 0 || searches > 0) {
      const parts: string[] = [];
      if (searches > 0) parts.push(`${searches} search${searches > 1 ? 'es' : ''}`);
      if (toolCalls > 0) parts.push(`${toolCalls} tool${toolCalls > 1 ? 's' : ''}`);
      return `Used ${parts.join(' and ')}`;
    }

    return 'Chain of thought';
  };

  return (
    <div class="grounded-agentic-steps">
      <button 
        class="grounded-agentic-header"
        onClick={handleToggle}
        type="button"
      >
        <span class="grounded-agentic-header-icon">
          {isStreaming && status.status !== 'idle' && status.status !== 'streaming' 
            ? <LoadingSpinner /> 
            : <BrainIcon />
          }
        </span>
        <span class="grounded-agentic-header-text">{getHeaderText()}</span>
        <span class="grounded-agentic-header-chevron">
          <ChevronIcon expanded={isExpanded} />
        </span>
      </button>

      {isExpanded && steps.length > 0 && (
        <div class="grounded-agentic-content">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            const isActive = isLast && isStreaming && status.status !== 'streaming';

            return (
              <div class="grounded-agentic-step" key={`${step.type}-${step.timestamp}`}>
                <div class="grounded-agentic-step-icon">
                  {getStepIcon(step.type, isActive)}
                </div>
                <div class="grounded-agentic-step-content">
                  <span class={`grounded-agentic-step-label ${isActive ? 'active' : ''}`}>
                    {getStepLabel(step)}
                  </span>
                </div>
                {!isLast && <div class="grounded-agentic-step-line" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Compact inline status indicator (alternative to full steps view)
interface AgenticStatusProps {
  status: ChatStatus;
}

export function AgenticStatus({ status }: AgenticStatusProps): JSX.Element | null {
  if (status.status === 'idle' || status.status === 'streaming') {
    return null;
  }

  const getIcon = () => {
    switch (status.status) {
      case 'thinking':
        return <BrainIcon />;
      case 'searching':
        return <SearchIcon />;
      case 'tool_call':
        return <WrenchIcon />;
      case 'generating':
        return <MessageIcon />;
      default:
        return <BrainIcon />;
    }
  };

  const getMessage = () => {
    switch (status.status) {
      case 'thinking':
        return status.message || 'Thinking...';
      case 'searching':
        return status.message || 'Searching...';
      case 'tool_call':
        return status.toolName ? `Using ${status.toolName}...` : 'Using tool...';
      case 'generating':
        return status.message || 'Generating...';
      default:
        return 'Processing...';
    }
  };

  return (
    <div class="grounded-agentic-status">
      <span class="grounded-agentic-status-icon">
        <LoadingSpinner />
      </span>
      <span class="grounded-agentic-status-text">{getMessage()}</span>
    </div>
  );
}
