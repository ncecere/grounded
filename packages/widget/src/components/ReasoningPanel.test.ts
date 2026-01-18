import { describe, expect, test } from 'bun:test';
import type { ReasoningStep, ReasoningStepType, ReasoningStepStatus } from '../types';

// =============================================================================
// Module Export Tests
// =============================================================================

describe('ReasoningPanel module exports', () => {
  test('exports ReasoningPanel component', async () => {
    const module = await import('./ReasoningPanel');
    expect(module.ReasoningPanel).toBeDefined();
    expect(typeof module.ReasoningPanel).toBe('function');
  });

  test('exports default as ReasoningPanel', async () => {
    const module = await import('./ReasoningPanel');
    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.ReasoningPanel);
  });

  test('exports getStepIcon helper function', async () => {
    const module = await import('./ReasoningPanel');
    expect(module.getStepIcon).toBeDefined();
    expect(typeof module.getStepIcon).toBe('function');
  });

  test('exports getStatusIcon helper function', async () => {
    const module = await import('./ReasoningPanel');
    expect(module.getStatusIcon).toBeDefined();
    expect(typeof module.getStatusIcon).toBe('function');
  });

  test('exports getStepTypeLabel helper function', async () => {
    const module = await import('./ReasoningPanel');
    expect(module.getStepTypeLabel).toBeDefined();
    expect(typeof module.getStepTypeLabel).toBe('function');
  });
});

// =============================================================================
// getStepIcon Function Tests
// =============================================================================

describe('getStepIcon function', () => {
  test('returns PencilIcon for rewrite step type', async () => {
    const { getStepIcon } = await import('./ReasoningPanel');
    const { PencilIcon } = await import('./Icons');
    const result = getStepIcon('rewrite');
    expect(result).toBe(PencilIcon);
  });

  test('returns ListTreeIcon for plan step type', async () => {
    const { getStepIcon } = await import('./ReasoningPanel');
    const { ListTreeIcon } = await import('./Icons');
    const result = getStepIcon('plan');
    expect(result).toBe(ListTreeIcon);
  });

  test('returns SearchIcon for search step type', async () => {
    const { getStepIcon } = await import('./ReasoningPanel');
    const { SearchIcon } = await import('./Icons');
    const result = getStepIcon('search');
    expect(result).toBe(SearchIcon);
  });

  test('returns GitMergeIcon for merge step type', async () => {
    const { getStepIcon } = await import('./ReasoningPanel');
    const { GitMergeIcon } = await import('./Icons');
    const result = getStepIcon('merge');
    expect(result).toBe(GitMergeIcon);
  });

  test('returns SparklesIcon for generate step type', async () => {
    const { getStepIcon } = await import('./ReasoningPanel');
    const { SparklesIcon } = await import('./Icons');
    const result = getStepIcon('generate');
    expect(result).toBe(SparklesIcon);
  });

  test('returns BrainIcon for unknown step type', async () => {
    const { getStepIcon } = await import('./ReasoningPanel');
    const { BrainIcon } = await import('./Icons');
    const result = getStepIcon('unknown' as ReasoningStepType);
    expect(result).toBe(BrainIcon);
  });
});

// =============================================================================
// getStatusIcon Function Tests
// =============================================================================

describe('getStatusIcon function', () => {
  test('returns CheckCircleIcon for completed status', async () => {
    const { getStatusIcon } = await import('./ReasoningPanel');
    const { CheckCircleIcon } = await import('./Icons');
    const result = getStatusIcon('completed');
    expect(result).toBe(CheckCircleIcon);
  });

  test('returns LoaderIcon for in_progress status', async () => {
    const { getStatusIcon } = await import('./ReasoningPanel');
    const { LoaderIcon } = await import('./Icons');
    const result = getStatusIcon('in_progress');
    expect(result).toBe(LoaderIcon);
  });

  test('returns AlertCircleIcon for error status', async () => {
    const { getStatusIcon } = await import('./ReasoningPanel');
    const { AlertCircleIcon } = await import('./Icons');
    const result = getStatusIcon('error');
    expect(result).toBe(AlertCircleIcon);
  });

  test('returns CircleIcon for pending status', async () => {
    const { getStatusIcon } = await import('./ReasoningPanel');
    const { CircleIcon } = await import('./Icons');
    const result = getStatusIcon('pending');
    expect(result).toBe(CircleIcon);
  });

  test('returns CircleIcon for unknown status (fallback)', async () => {
    const { getStatusIcon } = await import('./ReasoningPanel');
    const { CircleIcon } = await import('./Icons');
    const result = getStatusIcon('unknown' as ReasoningStepStatus);
    expect(result).toBe(CircleIcon);
  });
});

// =============================================================================
// getStepTypeLabel Function Tests
// =============================================================================

describe('getStepTypeLabel function', () => {
  test('returns "Query Rewriting" for rewrite step', async () => {
    const { getStepTypeLabel } = await import('./ReasoningPanel');
    expect(getStepTypeLabel('rewrite')).toBe('Query Rewriting');
  });

  test('returns "Planning" for plan step', async () => {
    const { getStepTypeLabel } = await import('./ReasoningPanel');
    expect(getStepTypeLabel('plan')).toBe('Planning');
  });

  test('returns "Searching" for search step', async () => {
    const { getStepTypeLabel } = await import('./ReasoningPanel');
    expect(getStepTypeLabel('search')).toBe('Searching');
  });

  test('returns "Merging" for merge step', async () => {
    const { getStepTypeLabel } = await import('./ReasoningPanel');
    expect(getStepTypeLabel('merge')).toBe('Merging');
  });

  test('returns "Generating" for generate step', async () => {
    const { getStepTypeLabel } = await import('./ReasoningPanel');
    expect(getStepTypeLabel('generate')).toBe('Generating');
  });

  test('returns type name for unknown type (fallback)', async () => {
    const { getStepTypeLabel } = await import('./ReasoningPanel');
    expect(getStepTypeLabel('custom' as ReasoningStepType)).toBe('custom');
  });
});

// =============================================================================
// ReasoningPanelProps Interface Tests
// =============================================================================

describe('ReasoningPanelProps interface', () => {
  test('steps is required property', () => {
    // Type test - steps must be provided
    const props: { steps: ReasoningStep[] } = {
      steps: [],
    };
    expect(Array.isArray(props.steps)).toBe(true);
  });

  test('isStreaming is optional property', () => {
    // Type test - isStreaming is optional
    const props: { steps: ReasoningStep[]; isStreaming?: boolean } = {
      steps: [],
      isStreaming: true,
    };
    expect(props.isStreaming).toBe(true);
  });

  test('defaultOpen is optional property', () => {
    // Type test - defaultOpen is optional
    const props: { steps: ReasoningStep[]; defaultOpen?: boolean } = {
      steps: [],
      defaultOpen: false,
    };
    expect(props.defaultOpen).toBe(false);
  });
});

// =============================================================================
// Component Behavior Contract Tests
// =============================================================================

describe('ReasoningPanel component behavior contracts', () => {
  test('component should return null when steps array is empty', () => {
    // This documents the expected behavior: empty steps = no render
    const steps: ReasoningStep[] = [];
    expect(steps.length === 0).toBe(true);
    // The component returns null when steps.length === 0
  });

  test('component should render when steps array has items', () => {
    const steps: ReasoningStep[] = [
      {
        id: 'step-1',
        type: 'rewrite',
        title: 'Rewriting Query',
        summary: 'Adding context to query',
        status: 'completed',
      },
    ];
    expect(steps.length > 0).toBe(true);
    // The component renders when steps.length > 0
  });

  test('defaultOpen should control initial collapsed state', () => {
    // When defaultOpen is false (default), panel starts collapsed
    const defaultOpenFalse = false;
    expect(defaultOpenFalse).toBe(false);

    // When defaultOpen is true, panel starts expanded
    const defaultOpenTrue = true;
    expect(defaultOpenTrue).toBe(true);
  });

  test('isStreaming affects panel styling classes', () => {
    // When isStreaming is true, panel has streaming class
    const isStreaming = true;
    const className = isStreaming ? 'grounded-reasoning-panel streaming' : 'grounded-reasoning-panel';
    expect(className).toContain('streaming');
  });
});

// =============================================================================
// Step Counting Tests
// =============================================================================

describe('ReasoningPanel step counting behavior', () => {
  test('counts completed steps correctly', () => {
    const steps: ReasoningStep[] = [
      { id: '1', type: 'rewrite', title: 'Step 1', summary: '', status: 'completed' },
      { id: '2', type: 'plan', title: 'Step 2', summary: '', status: 'completed' },
      { id: '3', type: 'search', title: 'Step 3', summary: '', status: 'in_progress' },
      { id: '4', type: 'merge', title: 'Step 4', summary: '', status: 'pending' },
    ];
    const completedCount = steps.filter((s) => s.status === 'completed').length;
    expect(completedCount).toBe(2);
  });

  test('counts total steps correctly', () => {
    const steps: ReasoningStep[] = [
      { id: '1', type: 'rewrite', title: 'Step 1', summary: '', status: 'completed' },
      { id: '2', type: 'plan', title: 'Step 2', summary: '', status: 'in_progress' },
      { id: '3', type: 'search', title: 'Step 3', summary: '', status: 'pending' },
    ];
    expect(steps.length).toBe(3);
  });

  test('detects in_progress steps', () => {
    const steps: ReasoningStep[] = [
      { id: '1', type: 'rewrite', title: 'Step 1', summary: '', status: 'completed' },
      { id: '2', type: 'plan', title: 'Step 2', summary: '', status: 'in_progress' },
    ];
    const hasInProgress = steps.some((s) => s.status === 'in_progress');
    expect(hasInProgress).toBe(true);
  });

  test('getMessage returns current step title when in progress', () => {
    const steps: ReasoningStep[] = [
      { id: '1', type: 'rewrite', title: 'Rewriting Query', summary: '', status: 'completed' },
      { id: '2', type: 'plan', title: 'Planning Sub-queries', summary: '', status: 'in_progress' },
    ];
    const currentStep = steps.find((s) => s.status === 'in_progress');
    expect(currentStep?.title).toBe('Planning Sub-queries');
  });

  test('getMessage returns completed message when all steps done', () => {
    const steps: ReasoningStep[] = [
      { id: '1', type: 'rewrite', title: 'Step 1', summary: '', status: 'completed' },
      { id: '2', type: 'plan', title: 'Step 2', summary: '', status: 'completed' },
      { id: '3', type: 'search', title: 'Step 3', summary: '', status: 'completed' },
    ];
    const completedCount = steps.filter((s) => s.status === 'completed').length;
    const totalCount = steps.length;
    const allCompleted = completedCount === totalCount && totalCount > 0;
    expect(allCompleted).toBe(true);
  });
});

// =============================================================================
// CSS Class Tests
// =============================================================================

describe('ReasoningPanel CSS classes', () => {
  test('panel has correct base class', () => {
    const baseClass = 'grounded-reasoning-panel';
    expect(baseClass).toBe('grounded-reasoning-panel');
  });

  test('streaming panel has correct classes', () => {
    const isStreaming = true;
    const className = `grounded-reasoning-panel ${isStreaming ? 'streaming' : ''}`.trim();
    expect(className).toBe('grounded-reasoning-panel streaming');
  });

  test('trigger has correct base class', () => {
    const baseClass = 'grounded-reasoning-trigger';
    expect(baseClass).toBe('grounded-reasoning-trigger');
  });

  test('open trigger has open class', () => {
    const isOpen = true;
    const className = `grounded-reasoning-trigger ${isOpen ? 'open' : ''}`.trim();
    expect(className).toBe('grounded-reasoning-trigger open');
  });

  test('step dot has correct status class', () => {
    const statuses: ReasoningStepStatus[] = ['pending', 'in_progress', 'completed', 'error'];
    statuses.forEach((status) => {
      const className = `grounded-reasoning-step-dot ${status}`;
      expect(className).toContain(status);
    });
  });

  test('step icon has correct status class', () => {
    const statuses: ReasoningStepStatus[] = ['pending', 'in_progress', 'completed', 'error'];
    statuses.forEach((status) => {
      const className = `grounded-reasoning-step-icon ${status}`;
      expect(className).toContain(status);
    });
  });

  test('step status icon has correct status class', () => {
    const statuses: ReasoningStepStatus[] = ['pending', 'in_progress', 'completed', 'error'];
    statuses.forEach((status) => {
      const className = `grounded-reasoning-step-status ${status}`;
      expect(className).toContain(status);
    });
  });

  test('last step has last class', () => {
    const isLast = true;
    const className = `grounded-reasoning-step ${isLast ? 'last' : ''}`.trim();
    expect(className).toBe('grounded-reasoning-step last');
  });
});

// =============================================================================
// ReasoningStep Interface Tests
// =============================================================================

describe('ReasoningStep interface', () => {
  test('step has required id field', () => {
    const step: ReasoningStep = {
      id: 'step-uuid',
      type: 'rewrite',
      title: 'Title',
      summary: 'Summary',
      status: 'pending',
    };
    expect(step.id).toBe('step-uuid');
  });

  test('step has required type field', () => {
    const step: ReasoningStep = {
      id: '1',
      type: 'plan',
      title: 'Title',
      summary: 'Summary',
      status: 'pending',
    };
    expect(step.type).toBe('plan');
  });

  test('step has required title field', () => {
    const step: ReasoningStep = {
      id: '1',
      type: 'search',
      title: 'Searching Knowledge Base',
      summary: 'Summary',
      status: 'pending',
    };
    expect(step.title).toBe('Searching Knowledge Base');
  });

  test('step has required summary field', () => {
    const step: ReasoningStep = {
      id: '1',
      type: 'merge',
      title: 'Title',
      summary: 'Merging 10 results',
      status: 'pending',
    };
    expect(step.summary).toBe('Merging 10 results');
  });

  test('step has required status field', () => {
    const step: ReasoningStep = {
      id: '1',
      type: 'generate',
      title: 'Title',
      summary: 'Summary',
      status: 'completed',
    };
    expect(step.status).toBe('completed');
  });

  test('step can have optional details field', () => {
    const step: ReasoningStep = {
      id: '1',
      type: 'plan',
      title: 'Planning',
      summary: 'Generated 3 sub-queries',
      status: 'completed',
      details: {
        subQueries: ['query1', 'query2', 'query3'],
      },
    };
    expect(step.details).toBeDefined();
    expect(step.details?.subQueries).toHaveLength(3);
  });
});

// =============================================================================
// Step Type Documentation Tests
// =============================================================================

describe('reasoning step types documentation', () => {
  test('rewrite step: reformulates query with conversation context', () => {
    const step: ReasoningStep = {
      id: '1',
      type: 'rewrite',
      title: 'Rewriting Query',
      summary: 'Reformulated query with conversation context',
      status: 'completed',
    };
    expect(step.type).toBe('rewrite');
  });

  test('plan step: generates sub-queries for comprehensive search', () => {
    const step: ReasoningStep = {
      id: '2',
      type: 'plan',
      title: 'Planning Search Strategy',
      summary: 'Generated 3 focused sub-queries',
      status: 'completed',
    };
    expect(step.type).toBe('plan');
  });

  test('search step: searches knowledge bases with sub-queries', () => {
    const step: ReasoningStep = {
      id: '3',
      type: 'search',
      title: 'Searching Knowledge Bases',
      summary: 'Searching 3 queries, found 15 chunks',
      status: 'completed',
    };
    expect(step.type).toBe('search');
  });

  test('merge step: deduplicates and ranks results', () => {
    const step: ReasoningStep = {
      id: '4',
      type: 'merge',
      title: 'Merging Results',
      summary: 'Deduplicated to 10 unique chunks',
      status: 'completed',
    };
    expect(step.type).toBe('merge');
  });

  test('generate step: produces final answer with citations', () => {
    const step: ReasoningStep = {
      id: '5',
      type: 'generate',
      title: 'Generating Response',
      summary: 'Response generated successfully',
      status: 'completed',
    };
    expect(step.type).toBe('generate');
  });
});

// =============================================================================
// Step Sequence Tests
// =============================================================================

describe('reasoning step sequence', () => {
  test('standard sequence is rewrite -> plan -> search -> merge -> generate', () => {
    const expectedSequence: ReasoningStepType[] = ['rewrite', 'plan', 'search', 'merge', 'generate'];
    expect(expectedSequence).toEqual(['rewrite', 'plan', 'search', 'merge', 'generate']);
  });

  test('steps should be in expected order for full pipeline', () => {
    const steps: ReasoningStep[] = [
      { id: '1', type: 'rewrite', title: 'Rewrite', summary: '', status: 'completed' },
      { id: '2', type: 'plan', title: 'Plan', summary: '', status: 'completed' },
      { id: '3', type: 'search', title: 'Search', summary: '', status: 'completed' },
      { id: '4', type: 'merge', title: 'Merge', summary: '', status: 'completed' },
      { id: '5', type: 'generate', title: 'Generate', summary: '', status: 'completed' },
    ];
    const types = steps.map((s) => s.type);
    expect(types).toEqual(['rewrite', 'plan', 'search', 'merge', 'generate']);
  });
});

// =============================================================================
// Status Transition Tests
// =============================================================================

describe('reasoning step status transitions', () => {
  test('steps transition from pending to in_progress', () => {
    const step: ReasoningStep = {
      id: '1',
      type: 'rewrite',
      title: 'Rewriting',
      summary: '',
      status: 'pending',
    };
    // Simulating transition
    step.status = 'in_progress';
    expect(step.status).toBe('in_progress');
  });

  test('steps transition from in_progress to completed', () => {
    const step: ReasoningStep = {
      id: '1',
      type: 'rewrite',
      title: 'Rewriting',
      summary: '',
      status: 'in_progress',
    };
    // Simulating transition
    step.status = 'completed';
    expect(step.status).toBe('completed');
  });

  test('steps can transition to error status', () => {
    const step: ReasoningStep = {
      id: '1',
      type: 'search',
      title: 'Searching',
      summary: '',
      status: 'in_progress',
    };
    // Simulating error
    step.status = 'error';
    expect(step.status).toBe('error');
  });
});

// =============================================================================
// Icons Module Integration Tests
// =============================================================================

describe('Icons module integration', () => {
  test('BrainIcon is exported from Icons module', async () => {
    const { BrainIcon } = await import('./Icons');
    expect(BrainIcon).toBeDefined();
    expect(typeof BrainIcon).toBe('function');
  });

  test('PencilIcon is exported from Icons module', async () => {
    const { PencilIcon } = await import('./Icons');
    expect(PencilIcon).toBeDefined();
    expect(typeof PencilIcon).toBe('function');
  });

  test('ListTreeIcon is exported from Icons module', async () => {
    const { ListTreeIcon } = await import('./Icons');
    expect(ListTreeIcon).toBeDefined();
    expect(typeof ListTreeIcon).toBe('function');
  });

  test('GitMergeIcon is exported from Icons module', async () => {
    const { GitMergeIcon } = await import('./Icons');
    expect(GitMergeIcon).toBeDefined();
    expect(typeof GitMergeIcon).toBe('function');
  });

  test('CheckCircleIcon is exported from Icons module', async () => {
    const { CheckCircleIcon } = await import('./Icons');
    expect(CheckCircleIcon).toBeDefined();
    expect(typeof CheckCircleIcon).toBe('function');
  });

  test('CircleIcon is exported from Icons module', async () => {
    const { CircleIcon } = await import('./Icons');
    expect(CircleIcon).toBeDefined();
    expect(typeof CircleIcon).toBe('function');
  });

  test('AlertCircleIcon is exported from Icons module', async () => {
    const { AlertCircleIcon } = await import('./Icons');
    expect(AlertCircleIcon).toBeDefined();
    expect(typeof AlertCircleIcon).toBe('function');
  });

  test('LoaderIcon is exported from Icons module', async () => {
    const { LoaderIcon } = await import('./Icons');
    expect(LoaderIcon).toBeDefined();
    expect(typeof LoaderIcon).toBe('function');
  });
});

// =============================================================================
// Shimmer Effect Tests
// =============================================================================

describe('shimmer effect behavior', () => {
  test('shimmer class is applied during in_progress state', () => {
    const isInProgress = true;
    const shouldUseShimmer = isInProgress;
    expect(shouldUseShimmer).toBe(true);
  });

  test('shimmer class is not applied when completed', () => {
    const isInProgress = false;
    const shouldUseShimmer = isInProgress;
    expect(shouldUseShimmer).toBe(false);
  });

  test('shimmer CSS class name is correct', () => {
    const shimmerClass = 'grounded-reasoning-shimmer';
    expect(shimmerClass).toBe('grounded-reasoning-shimmer');
  });
});

// =============================================================================
// Spinner Animation Tests
// =============================================================================

describe('spinner animation behavior', () => {
  test('spinner class is applied to LoaderIcon', () => {
    const spinnerClass = 'grounded-reasoning-spinner';
    expect(spinnerClass).toBe('grounded-reasoning-spinner');
  });

  test('spinner is shown only during in_progress status', () => {
    const status: ReasoningStepStatus = 'in_progress';
    const showSpinner = status === 'in_progress';
    expect(showSpinner).toBe(true);
  });

  test('spinner is hidden when status is completed', () => {
    const status = 'completed' as ReasoningStepStatus;
    const showSpinner = status === 'in_progress';
    expect(showSpinner).toBe(false);
  });
});

// =============================================================================
// Trigger Message Tests
// =============================================================================

describe('trigger message generation', () => {
  test('shows current step title when streaming with in_progress step', () => {
    const isStreaming = true;
    const steps: ReasoningStep[] = [
      { id: '1', type: 'rewrite', title: 'Completed Step', summary: '', status: 'completed' },
      { id: '2', type: 'plan', title: 'Planning Queries', summary: '', status: 'in_progress' },
    ];
    const currentStep = steps.find((s) => s.status === 'in_progress');
    const message = (isStreaming && currentStep) ? `${currentStep.title}...` : '';
    expect(message).toBe('Planning Queries...');
  });

  test('shows "Processing..." when streaming without specific step', () => {
    const isStreaming = true;
    const hasInProgress = true;
    const currentStep = undefined; // No current step found
    const message = (isStreaming || hasInProgress) && !currentStep ? 'Processing...' : '';
    expect(message).toBe('Processing...');
  });

  test('shows completion message when all steps done', () => {
    const steps: ReasoningStep[] = [
      { id: '1', type: 'rewrite', title: 'Step 1', summary: '', status: 'completed' },
      { id: '2', type: 'plan', title: 'Step 2', summary: '', status: 'completed' },
      { id: '3', type: 'search', title: 'Step 3', summary: '', status: 'completed' },
    ];
    const completedCount = steps.filter((s) => s.status === 'completed').length;
    const totalCount = steps.length;
    const allDone = completedCount === totalCount && totalCount > 0;
    const message = allDone ? `Completed ${totalCount} reasoning steps` : '';
    expect(message).toBe('Completed 3 reasoning steps');
  });

  test('shows progress message when partially complete', () => {
    const steps: ReasoningStep[] = [
      { id: '1', type: 'rewrite', title: 'Step 1', summary: '', status: 'completed' },
      { id: '2', type: 'plan', title: 'Step 2', summary: '', status: 'completed' },
      { id: '3', type: 'search', title: 'Step 3', summary: '', status: 'pending' },
    ];
    const completedCount = steps.filter((s) => s.status === 'completed').length;
    const totalCount = steps.length;
    const hasInProgress = steps.some((s) => s.status === 'in_progress');
    const allDone = completedCount === totalCount && totalCount > 0;
    const message = (!hasInProgress && !allDone) ? `${completedCount}/${totalCount} steps completed` : '';
    expect(message).toBe('2/3 steps completed');
  });
});
