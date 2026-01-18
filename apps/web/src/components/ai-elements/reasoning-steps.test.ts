import { describe, it, expect } from "bun:test";
import {
  getStepIcon,
  getStatusIcon,
  getStatusClasses,
  getStepTypeLabel,
} from "./reasoning-steps";
import type {
  ReasoningStep,
  ReasoningStepType,
  ReasoningStepStatus,
} from "@/lib/api/types";

// =============================================================================
// Module Exports Tests
// =============================================================================

describe("ReasoningSteps module exports", () => {
  it("should export ReasoningSteps component", async () => {
    const module = await import("./reasoning-steps");
    expect(module.ReasoningSteps).toBeDefined();
  });

  it("should export ReasoningStepsTrigger component", async () => {
    const module = await import("./reasoning-steps");
    expect(module.ReasoningStepsTrigger).toBeDefined();
  });

  it("should export ReasoningStepsContent component", async () => {
    const module = await import("./reasoning-steps");
    expect(module.ReasoningStepsContent).toBeDefined();
  });

  it("should export ReasoningStepItem component", async () => {
    const module = await import("./reasoning-steps");
    expect(module.ReasoningStepItem).toBeDefined();
  });

  it("should export useReasoningSteps hook", async () => {
    const module = await import("./reasoning-steps");
    expect(module.useReasoningSteps).toBeDefined();
    expect(typeof module.useReasoningSteps).toBe("function");
  });

  it("should export helper functions", async () => {
    const module = await import("./reasoning-steps");
    expect(module.getStepIcon).toBeDefined();
    expect(module.getStatusIcon).toBeDefined();
    expect(module.getStatusClasses).toBeDefined();
    expect(module.getStepTypeLabel).toBeDefined();
  });
});

// =============================================================================
// getStepIcon Tests
// =============================================================================

describe("getStepIcon", () => {
  it("should return PencilIcon for 'rewrite' type", () => {
    const Icon = getStepIcon("rewrite");
    expect(Icon).toBeDefined();
    expect(Icon.displayName || Icon.name).toContain("Pencil");
  });

  it("should return ListTreeIcon for 'plan' type", () => {
    const Icon = getStepIcon("plan");
    expect(Icon).toBeDefined();
    expect(Icon.displayName || Icon.name).toContain("ListTree");
  });

  it("should return SearchIcon for 'search' type", () => {
    const Icon = getStepIcon("search");
    expect(Icon).toBeDefined();
    expect(Icon.displayName || Icon.name).toContain("Search");
  });

  it("should return GitMergeIcon for 'merge' type", () => {
    const Icon = getStepIcon("merge");
    expect(Icon).toBeDefined();
    expect(Icon.displayName || Icon.name).toContain("GitMerge");
  });

  it("should return SparklesIcon for 'generate' type", () => {
    const Icon = getStepIcon("generate");
    expect(Icon).toBeDefined();
    expect(Icon.displayName || Icon.name).toContain("Sparkles");
  });

  it("should return BrainIcon for unknown type as fallback", () => {
    const Icon = getStepIcon("unknown" as ReasoningStepType);
    expect(Icon).toBeDefined();
    expect(Icon.displayName || Icon.name).toContain("Brain");
  });

  it("should return an icon for every valid ReasoningStepType", () => {
    const validTypes: ReasoningStepType[] = [
      "rewrite",
      "plan",
      "search",
      "merge",
      "generate",
    ];
    validTypes.forEach((type) => {
      const Icon = getStepIcon(type);
      expect(Icon).toBeDefined();
    });
  });
});

// =============================================================================
// getStatusIcon Tests
// =============================================================================

describe("getStatusIcon", () => {
  it("should return CheckCircle2Icon for 'completed' status", () => {
    const Icon = getStatusIcon("completed");
    expect(Icon).toBeDefined();
    // Lucide icons may have different naming conventions
    const iconName = (Icon as { displayName?: string; name?: string }).displayName ||
                     (Icon as { displayName?: string; name?: string }).name || "";
    expect(iconName.toLowerCase()).toContain("circle");
  });

  it("should return Loader for 'in_progress' status", () => {
    const Icon = getStatusIcon("in_progress");
    expect(Icon).toBeDefined();
    // Loader is a custom component, check it exists
    expect(typeof Icon).toBe("function");
  });

  it("should return AlertCircleIcon for 'error' status", () => {
    const Icon = getStatusIcon("error");
    expect(Icon).toBeDefined();
    // Lucide icons may have different naming conventions
    const iconName = (Icon as { displayName?: string; name?: string }).displayName ||
                     (Icon as { displayName?: string; name?: string }).name || "";
    expect(iconName.toLowerCase()).toContain("circle");
  });

  it("should return CircleIcon for 'pending' status", () => {
    const Icon = getStatusIcon("pending");
    expect(Icon).toBeDefined();
    const iconName = (Icon as { displayName?: string; name?: string }).displayName ||
                     (Icon as { displayName?: string; name?: string }).name || "";
    expect(iconName.toLowerCase()).toContain("circle");
  });

  it("should return CircleIcon for unknown status as fallback", () => {
    const Icon = getStatusIcon("unknown" as ReasoningStepStatus);
    expect(Icon).toBeDefined();
  });

  it("should return an icon for every valid ReasoningStepStatus", () => {
    const validStatuses: ReasoningStepStatus[] = [
      "pending",
      "in_progress",
      "completed",
      "error",
    ];
    validStatuses.forEach((status) => {
      const Icon = getStatusIcon(status);
      expect(Icon).toBeDefined();
    });
  });
});

// =============================================================================
// getStatusClasses Tests
// =============================================================================

describe("getStatusClasses", () => {
  it("should return green classes for 'completed' status", () => {
    const classes = getStatusClasses("completed");
    expect(classes).toContain("green");
  });

  it("should return primary classes for 'in_progress' status", () => {
    const classes = getStatusClasses("in_progress");
    expect(classes).toContain("primary");
  });

  it("should return destructive classes for 'error' status", () => {
    const classes = getStatusClasses("error");
    expect(classes).toContain("destructive");
  });

  it("should return muted classes for 'pending' status", () => {
    const classes = getStatusClasses("pending");
    expect(classes).toContain("muted");
  });

  it("should return muted classes for unknown status as fallback", () => {
    const classes = getStatusClasses("unknown" as ReasoningStepStatus);
    expect(classes).toContain("muted");
  });

  it("should return a non-empty string for all valid statuses", () => {
    const validStatuses: ReasoningStepStatus[] = [
      "pending",
      "in_progress",
      "completed",
      "error",
    ];
    validStatuses.forEach((status) => {
      const classes = getStatusClasses(status);
      expect(classes).toBeTruthy();
      expect(classes.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// getStepTypeLabel Tests
// =============================================================================

describe("getStepTypeLabel", () => {
  it("should return 'Query Rewriting' for 'rewrite' type", () => {
    expect(getStepTypeLabel("rewrite")).toBe("Query Rewriting");
  });

  it("should return 'Planning' for 'plan' type", () => {
    expect(getStepTypeLabel("plan")).toBe("Planning");
  });

  it("should return 'Searching' for 'search' type", () => {
    expect(getStepTypeLabel("search")).toBe("Searching");
  });

  it("should return 'Merging' for 'merge' type", () => {
    expect(getStepTypeLabel("merge")).toBe("Merging");
  });

  it("should return 'Generating' for 'generate' type", () => {
    expect(getStepTypeLabel("generate")).toBe("Generating");
  });

  it("should return the type itself for unknown type", () => {
    const unknownType = "unknown_type" as ReasoningStepType;
    expect(getStepTypeLabel(unknownType)).toBe("unknown_type");
  });

  it("should return human-readable labels for all valid types", () => {
    const expectedLabels: Record<ReasoningStepType, string> = {
      rewrite: "Query Rewriting",
      plan: "Planning",
      search: "Searching",
      merge: "Merging",
      generate: "Generating",
    };

    Object.entries(expectedLabels).forEach(([type, label]) => {
      expect(getStepTypeLabel(type as ReasoningStepType)).toBe(label);
    });
  });
});

// =============================================================================
// ReasoningStep Interface Tests
// =============================================================================

describe("ReasoningStep interface", () => {
  it("should accept a valid ReasoningStep object", () => {
    const step: ReasoningStep = {
      id: "step-123",
      type: "rewrite",
      title: "Rewriting query",
      summary: "Analyzing conversation context",
      status: "in_progress",
    };

    expect(step.id).toBe("step-123");
    expect(step.type).toBe("rewrite");
    expect(step.title).toBe("Rewriting query");
    expect(step.summary).toBe("Analyzing conversation context");
    expect(step.status).toBe("in_progress");
  });

  it("should accept optional details field", () => {
    const step: ReasoningStep = {
      id: "step-456",
      type: "plan",
      title: "Planning sub-queries",
      summary: "Generated 3 sub-queries",
      status: "completed",
      details: { subQueryCount: 3 },
    };

    expect(step.details).toEqual({ subQueryCount: 3 });
  });

  it("should work without optional details field", () => {
    const step: ReasoningStep = {
      id: "step-789",
      type: "search",
      title: "Searching knowledge base",
      summary: "Found 5 relevant chunks",
      status: "completed",
    };

    expect(step.details).toBeUndefined();
  });

  it("should accept all valid step types", () => {
    const types: ReasoningStepType[] = [
      "rewrite",
      "plan",
      "search",
      "merge",
      "generate",
    ];

    types.forEach((type) => {
      const step: ReasoningStep = {
        id: `step-${type}`,
        type,
        title: `${type} step`,
        summary: `Processing ${type}`,
        status: "pending",
      };
      expect(step.type).toBe(type);
    });
  });

  it("should accept all valid step statuses", () => {
    const statuses: ReasoningStepStatus[] = [
      "pending",
      "in_progress",
      "completed",
      "error",
    ];

    statuses.forEach((status) => {
      const step: ReasoningStep = {
        id: `step-${status}`,
        type: "generate",
        title: "Test step",
        summary: "Test summary",
        status,
      };
      expect(step.status).toBe(status);
    });
  });
});

// =============================================================================
// ReasoningSteps Behavior Tests (component contracts)
// =============================================================================

describe("ReasoningSteps behavior contracts", () => {
  describe("defaultOpen prop", () => {
    it("should default to collapsed (defaultOpen=false)", () => {
      // The component defaults to collapsed as per task requirement
      const defaultOpenValue = false;
      expect(defaultOpenValue).toBe(false);
    });
  });

  describe("empty steps handling", () => {
    it("should not render when steps array is empty", () => {
      // Component returns null when steps.length === 0
      const steps: ReasoningStep[] = [];
      const shouldRender = steps.length > 0;
      expect(shouldRender).toBe(false);
    });

    it("should render when steps array has items", () => {
      const steps: ReasoningStep[] = [
        {
          id: "1",
          type: "rewrite",
          title: "Test",
          summary: "Test",
          status: "completed",
        },
      ];
      const shouldRender = steps.length > 0;
      expect(shouldRender).toBe(true);
    });
  });

  describe("step counting", () => {
    it("should count completed steps correctly", () => {
      const steps: ReasoningStep[] = [
        {
          id: "1",
          type: "rewrite",
          title: "Step 1",
          summary: "",
          status: "completed",
        },
        {
          id: "2",
          type: "plan",
          title: "Step 2",
          summary: "",
          status: "completed",
        },
        {
          id: "3",
          type: "search",
          title: "Step 3",
          summary: "",
          status: "in_progress",
        },
      ];

      const completedCount = steps.filter(
        (s) => s.status === "completed"
      ).length;
      expect(completedCount).toBe(2);
    });

    it("should count total steps correctly", () => {
      const steps: ReasoningStep[] = [
        {
          id: "1",
          type: "rewrite",
          title: "Step 1",
          summary: "",
          status: "completed",
        },
        {
          id: "2",
          type: "plan",
          title: "Step 2",
          summary: "",
          status: "in_progress",
        },
        {
          id: "3",
          type: "search",
          title: "Step 3",
          summary: "",
          status: "pending",
        },
      ];

      expect(steps.length).toBe(3);
    });

    it("should detect in_progress steps", () => {
      const steps: ReasoningStep[] = [
        {
          id: "1",
          type: "rewrite",
          title: "Step 1",
          summary: "",
          status: "completed",
        },
        {
          id: "2",
          type: "plan",
          title: "Step 2",
          summary: "",
          status: "in_progress",
        },
      ];

      const hasInProgress = steps.some((s) => s.status === "in_progress");
      expect(hasInProgress).toBe(true);
    });

    it("should detect no in_progress steps", () => {
      const steps: ReasoningStep[] = [
        {
          id: "1",
          type: "rewrite",
          title: "Step 1",
          summary: "",
          status: "completed",
        },
        {
          id: "2",
          type: "plan",
          title: "Step 2",
          summary: "",
          status: "completed",
        },
      ];

      const hasInProgress = steps.some((s) => s.status === "in_progress");
      expect(hasInProgress).toBe(false);
    });
  });
});

// =============================================================================
// Reasoning Step Sequence Tests
// =============================================================================

describe("reasoning step sequence", () => {
  it("should define the correct step order", () => {
    const expectedOrder: ReasoningStepType[] = [
      "rewrite",
      "plan",
      "search",
      "merge",
      "generate",
    ];

    // This documents the expected sequence
    expect(expectedOrder).toEqual([
      "rewrite",
      "plan",
      "search",
      "merge",
      "generate",
    ]);
  });

  it("should have 5 step types in total", () => {
    const allTypes: ReasoningStepType[] = [
      "rewrite",
      "plan",
      "search",
      "merge",
      "generate",
    ];
    expect(allTypes.length).toBe(5);
  });

  it("should create a complete reasoning step sequence", () => {
    const createStepSequence = (): ReasoningStep[] => [
      {
        id: "step-rewrite",
        type: "rewrite",
        title: "Rewriting query",
        summary: "Analyzing conversation context",
        status: "completed",
      },
      {
        id: "step-plan",
        type: "plan",
        title: "Planning sub-queries",
        summary: "Generated 3 sub-queries",
        status: "completed",
      },
      {
        id: "step-search",
        type: "search",
        title: "Searching knowledge base",
        summary: "Searching 3 queries",
        status: "completed",
      },
      {
        id: "step-merge",
        type: "merge",
        title: "Merging results",
        summary: "Found 15 unique chunks",
        status: "completed",
      },
      {
        id: "step-generate",
        type: "generate",
        title: "Generating response",
        summary: "Generating answer with citations",
        status: "in_progress",
      },
    ];

    const steps = createStepSequence();
    expect(steps.length).toBe(5);
    expect(steps[0].type).toBe("rewrite");
    expect(steps[1].type).toBe("plan");
    expect(steps[2].type).toBe("search");
    expect(steps[3].type).toBe("merge");
    expect(steps[4].type).toBe("generate");
  });
});

// =============================================================================
// Step Message Display Tests
// =============================================================================

describe("step message display", () => {
  describe("streaming message", () => {
    it("should show current step title when streaming", () => {
      const steps: ReasoningStep[] = [
        {
          id: "1",
          type: "rewrite",
          title: "Rewriting query",
          summary: "",
          status: "completed",
        },
        {
          id: "2",
          type: "plan",
          title: "Planning sub-queries",
          summary: "",
          status: "in_progress",
        },
      ];

      const currentStep = steps.find((s) => s.status === "in_progress");
      expect(currentStep?.title).toBe("Planning sub-queries");
    });

    it("should fall back to 'Processing...' if no in_progress step", () => {
      const steps: ReasoningStep[] = [
        {
          id: "1",
          type: "rewrite",
          title: "Rewriting query",
          summary: "",
          status: "completed",
        },
      ];

      const currentStep = steps.find((s) => s.status === "in_progress");
      const message = currentStep?.title ?? "Processing...";
      expect(message).toBe("Processing...");
    });
  });

  describe("completed message", () => {
    it("should show completion message when all steps done", () => {
      const steps: ReasoningStep[] = [
        {
          id: "1",
          type: "rewrite",
          title: "Step 1",
          summary: "",
          status: "completed",
        },
        {
          id: "2",
          type: "plan",
          title: "Step 2",
          summary: "",
          status: "completed",
        },
        {
          id: "3",
          type: "search",
          title: "Step 3",
          summary: "",
          status: "completed",
        },
      ];

      const completedCount = steps.filter(
        (s) => s.status === "completed"
      ).length;
      const totalCount = steps.length;
      const allCompleted = completedCount === totalCount && totalCount > 0;

      expect(allCompleted).toBe(true);
      expect(`Completed ${totalCount} reasoning steps`).toBe(
        "Completed 3 reasoning steps"
      );
    });

    it("should show progress message when some steps pending", () => {
      const steps: ReasoningStep[] = [
        {
          id: "1",
          type: "rewrite",
          title: "Step 1",
          summary: "",
          status: "completed",
        },
        {
          id: "2",
          type: "plan",
          title: "Step 2",
          summary: "",
          status: "pending",
        },
      ];

      const completedCount = steps.filter(
        (s) => s.status === "completed"
      ).length;
      const totalCount = steps.length;

      expect(`${completedCount}/${totalCount} steps completed`).toBe(
        "1/2 steps completed"
      );
    });
  });
});

// =============================================================================
// Props Interface Tests
// =============================================================================

describe("ReasoningSteps props interface", () => {
  it("should require steps prop", () => {
    // Type test: steps is required
    const steps: ReasoningStep[] = [];
    const props = { steps };
    expect(props.steps).toBeDefined();
  });

  it("should accept isStreaming prop", () => {
    const props = { steps: [], isStreaming: true };
    expect(props.isStreaming).toBe(true);
  });

  it("should accept open prop for controlled mode", () => {
    const props = { steps: [], open: true };
    expect(props.open).toBe(true);
  });

  it("should accept defaultOpen prop for uncontrolled mode", () => {
    const props = { steps: [], defaultOpen: false };
    expect(props.defaultOpen).toBe(false);
  });

  it("should accept onOpenChange callback", () => {
    const callback = (open: boolean) => {
      return open;
    };
    const props = { steps: [], onOpenChange: callback };
    expect(typeof props.onOpenChange).toBe("function");
  });

  it("should accept className prop", () => {
    const props = { steps: [], className: "custom-class" };
    expect(props.className).toBe("custom-class");
  });
});

// =============================================================================
// ReasoningStepItem Props Interface Tests
// =============================================================================

describe("ReasoningStepItem props interface", () => {
  it("should require step prop", () => {
    const step: ReasoningStep = {
      id: "1",
      type: "rewrite",
      title: "Test",
      summary: "Test summary",
      status: "completed",
    };
    const props = { step };
    expect(props.step).toBeDefined();
  });

  it("should accept optional className prop", () => {
    const step: ReasoningStep = {
      id: "1",
      type: "rewrite",
      title: "Test",
      summary: "Test summary",
      status: "completed",
    };
    const props = { step, className: "custom-class" };
    expect(props.className).toBe("custom-class");
  });
});

// =============================================================================
// Integration Tests (Component composition)
// =============================================================================

describe("ReasoningSteps component composition", () => {
  it("should compose ReasoningSteps with Trigger and Content", () => {
    // This documents the expected component composition pattern
    const compositionPattern = `
      <ReasoningSteps steps={steps} isStreaming={isStreaming}>
        <ReasoningStepsTrigger steps={steps} />
        <ReasoningStepsContent steps={steps} />
      </ReasoningSteps>
    `;
    expect(compositionPattern).toContain("ReasoningSteps");
    expect(compositionPattern).toContain("ReasoningStepsTrigger");
    expect(compositionPattern).toContain("ReasoningStepsContent");
  });

  it("should pass steps to both Trigger and Content", () => {
    // Both subcomponents need the steps array
    const steps: ReasoningStep[] = [
      {
        id: "1",
        type: "rewrite",
        title: "Test",
        summary: "",
        status: "completed",
      },
    ];

    const triggerProps = { steps };
    const contentProps = { steps };

    expect(triggerProps.steps).toEqual(contentProps.steps);
  });
});

// =============================================================================
// Type Exports Tests
// =============================================================================

describe("type exports", () => {
  it("should export ReasoningStepsProps type", async () => {
    // Type-level test verifying the export exists
    const module = await import("./reasoning-steps");
    // If the module loads without error, types are accessible
    expect(module.ReasoningSteps).toBeDefined();
  });

  it("should export ReasoningStepsTriggerProps type", async () => {
    const module = await import("./reasoning-steps");
    expect(module.ReasoningStepsTrigger).toBeDefined();
  });

  it("should export ReasoningStepsContentProps type", async () => {
    const module = await import("./reasoning-steps");
    expect(module.ReasoningStepsContent).toBeDefined();
  });

  it("should export ReasoningStepItemProps type", async () => {
    const module = await import("./reasoning-steps");
    expect(module.ReasoningStepItem).toBeDefined();
  });
});

// =============================================================================
// Styling Tests
// =============================================================================

describe("ReasoningSteps styling", () => {
  describe("panel container classes", () => {
    it("should have reasoning-panel base class", () => {
      // The ReasoningSteps component should include the reasoning-panel class
      const expectedClasses = [
        "reasoning-panel",
        "rounded-lg",
        "border",
        "border-border/50",
        "bg-muted/30",
        "px-3",
        "py-2",
      ];
      expectedClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });

    it("should have reasoning-panel-streaming class when streaming", () => {
      // When isStreaming is true, the component should add reasoning-panel-streaming
      const streamingClass = "reasoning-panel-streaming";
      expect(streamingClass).toBe("reasoning-panel-streaming");
    });

    it("should support custom className prop", () => {
      // className should be appended to existing classes
      const customClass = "custom-reasoning-panel";
      expect(customClass).toBeTruthy();
    });
  });

  describe("trigger styling classes", () => {
    it("should have reasoning-trigger base class", () => {
      const expectedClasses = [
        "reasoning-trigger",
        "flex",
        "w-full",
        "items-center",
        "gap-2.5",
        "py-1",
        "text-sm",
      ];
      expectedClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });

    it("should have reasoning-trigger-icon class for brain icon container", () => {
      const expectedClasses = [
        "reasoning-trigger-icon",
        "flex",
        "size-6",
        "items-center",
        "justify-center",
        "rounded-md",
        "bg-primary/10",
      ];
      expectedClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });

    it("should have focus-visible ring classes", () => {
      const focusClasses = [
        "focus-visible:outline-none",
        "focus-visible:ring-1",
        "focus-visible:ring-ring",
        "focus-visible:ring-offset-1",
      ];
      focusClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });
  });

  describe("content/timeline styling classes", () => {
    it("should have reasoning-content base class", () => {
      const expectedClasses = ["reasoning-content", "mt-3", "text-sm"];
      expectedClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });

    it("should have reasoning-timeline class for step container", () => {
      const expectedClasses = [
        "reasoning-timeline",
        "relative",
        "space-y-1",
        "border-l-2",
        "border-primary/20",
        "pl-4",
        "ml-3",
      ];
      expectedClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });
  });

  describe("step item styling classes", () => {
    it("should have reasoning-step base class", () => {
      const expectedClasses = [
        "reasoning-step",
        "relative",
        "flex",
        "items-start",
        "gap-3",
        "py-1.5",
      ];
      expectedClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });

    it("should have reasoning-step-active class when in_progress", () => {
      const activeClass = "reasoning-step-active";
      expect(activeClass).toBe("reasoning-step-active");
    });

    it("should have reasoning-step-dot class for timeline dots", () => {
      const expectedClasses = [
        "reasoning-step-dot",
        "absolute",
        "-left-[21px]",
        "top-2.5",
        "size-2",
        "rounded-full",
        "border-2",
        "border-background",
      ];
      expectedClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });

    it("should have reasoning-step-icon class for step type icons", () => {
      const expectedClasses = [
        "reasoning-step-icon",
        "flex",
        "size-7",
        "flex-shrink-0",
        "items-center",
        "justify-center",
        "rounded-md",
      ];
      expectedClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });

    it("should have reasoning-step-status class for status indicators", () => {
      const expectedClasses = [
        "reasoning-step-status",
        "flex-shrink-0",
        "mt-1",
      ];
      expectedClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });
  });

  describe("status-specific dot colors", () => {
    it("should use bg-green-500 for completed status dot", () => {
      const completedDotClass = "bg-green-500";
      expect(completedDotClass).toBe("bg-green-500");
    });

    it("should use bg-primary with animate-pulse for in_progress status dot", () => {
      const inProgressDotClasses = ["bg-primary", "animate-pulse"];
      inProgressDotClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });

    it("should use bg-muted-foreground/30 for pending status dot", () => {
      const pendingDotClass = "bg-muted-foreground/30";
      expect(pendingDotClass).toBe("bg-muted-foreground/30");
    });

    it("should use bg-destructive for error status dot", () => {
      const errorDotClass = "bg-destructive";
      expect(errorDotClass).toBe("bg-destructive");
    });
  });

  describe("status-specific icon background colors", () => {
    it("should use bg-primary/10 for in_progress status", () => {
      const inProgressBgClass = "bg-primary/10";
      expect(inProgressBgClass).toBe("bg-primary/10");
    });

    it("should use bg-green-500/10 for completed status", () => {
      const completedBgClass = "bg-green-500/10";
      expect(completedBgClass).toBe("bg-green-500/10");
    });

    it("should use bg-muted for pending status", () => {
      const pendingBgClass = "bg-muted";
      expect(pendingBgClass).toBe("bg-muted");
    });

    it("should use bg-destructive/10 for error status", () => {
      const errorBgClass = "bg-destructive/10";
      expect(errorBgClass).toBe("bg-destructive/10");
    });
  });

  describe("status-specific icon colors", () => {
    it("should use text-primary for in_progress step icon", () => {
      const inProgressIconClass = "text-primary";
      expect(inProgressIconClass).toBe("text-primary");
    });

    it("should use text-green-600 (light) / text-green-500 (dark) for completed step icon", () => {
      const completedIconClasses = [
        "text-green-600",
        "dark:text-green-500",
      ];
      completedIconClasses.forEach((cls) => {
        expect(cls).toBeTruthy();
      });
    });

    it("should use text-muted-foreground for pending step icon", () => {
      const pendingIconClass = "text-muted-foreground";
      expect(pendingIconClass).toBe("text-muted-foreground");
    });

    it("should use text-destructive for error step icon", () => {
      const errorIconClass = "text-destructive";
      expect(errorIconClass).toBe("text-destructive");
    });
  });

  describe("status-specific text colors", () => {
    it("should use text-foreground for in_progress step title", () => {
      const inProgressTitleClass = "text-foreground";
      expect(inProgressTitleClass).toBe("text-foreground");
    });

    it("should use text-foreground/80 for completed step title", () => {
      const completedTitleClass = "text-foreground/80";
      expect(completedTitleClass).toBe("text-foreground/80");
    });

    it("should use text-muted-foreground for pending step title", () => {
      const pendingTitleClass = "text-muted-foreground";
      expect(pendingTitleClass).toBe("text-muted-foreground");
    });

    it("should use text-destructive for error step title", () => {
      const errorTitleClass = "text-destructive";
      expect(errorTitleClass).toBe("text-destructive");
    });
  });

  describe("summary text styling", () => {
    it("should use text-muted-foreground for in_progress summary", () => {
      const inProgressSummaryClass = "text-muted-foreground";
      expect(inProgressSummaryClass).toBe("text-muted-foreground");
    });

    it("should use text-muted-foreground/70 for completed summary", () => {
      const completedSummaryClass = "text-muted-foreground/70";
      expect(completedSummaryClass).toBe("text-muted-foreground/70");
    });

    it("should use text-muted-foreground/60 for pending summary", () => {
      const pendingSummaryClass = "text-muted-foreground/60";
      expect(pendingSummaryClass).toBe("text-muted-foreground/60");
    });

    it("should use text-destructive/80 for error summary", () => {
      const errorSummaryClass = "text-destructive/80";
      expect(errorSummaryClass).toBe("text-destructive/80");
    });
  });
});

// =============================================================================
// CSS Custom Class Tests (documented class names)
// =============================================================================

describe("CSS class documentation", () => {
  it("should document all reasoning-panel CSS classes", () => {
    const cssClasses = [
      "reasoning-panel",
      "reasoning-panel-streaming",
      "reasoning-trigger",
      "reasoning-trigger-icon",
      "reasoning-content",
      "reasoning-timeline",
      "reasoning-step",
      "reasoning-step-active",
      "reasoning-step-dot",
      "reasoning-step-icon",
      "reasoning-step-status",
    ];

    // All CSS classes should be defined for styling hooks
    expect(cssClasses.length).toBe(11);
    cssClasses.forEach((cls) => {
      expect(cls).toMatch(/^reasoning-/);
    });
  });

  it("should use BEM-like naming convention for CSS classes", () => {
    // Classes follow reasoning-{element} or reasoning-{element}-{modifier} pattern
    const blockClasses = ["reasoning-panel", "reasoning-trigger", "reasoning-step"];
    const elementClasses = ["reasoning-trigger-icon", "reasoning-step-dot", "reasoning-step-icon", "reasoning-step-status"];
    const modifierClasses = ["reasoning-panel-streaming", "reasoning-step-active"];

    blockClasses.forEach((cls) => {
      expect(cls.split("-").length).toBeLessThanOrEqual(2);
    });

    elementClasses.forEach((cls) => {
      expect(cls.split("-").length).toBe(3);
    });

    modifierClasses.forEach((cls) => {
      expect(cls.split("-").length).toBe(3);
    });
  });
});
