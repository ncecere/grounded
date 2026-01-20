import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Calendar, ListChecks, Plus, Settings } from "lucide-react";
import { api, type ModelConfiguration, type TestCase, type TestSuite } from "../../lib/api";
import {
  useCreateTestCase,
  useDeleteTestCase,
  useReorderTestCases,
  useTestCases,
  useUpdateTestCase,
} from "../../lib/api/test-suites.hooks";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { EmptyState } from "../ui/empty-state";
import { LoadingSkeleton } from "../ui/loading-skeleton";
import { TestCaseCard } from "./TestCaseCard";
import { TestCaseForm, type TestCaseFormValues } from "./TestCaseForm";
import { ImportTestCasesDialog } from "./ImportTestCasesDialog";
import { DEFAULT_EXPECTED_BEHAVIOR } from "./ExpectedBehaviorEditor";

type DetailTab = "general" | "schedule" | "evaluation" | "cases";

export const DEFAULT_TEST_SUITE_FORM = {
  name: "",
  description: "",
  scheduleType: "manual" as TestSuite["scheduleType"],
  scheduleTime: "",
  scheduleDayOfWeek: "",
  llmJudgeModelConfigId: "",
  alertOnRegression: true,
  alertThresholdPercent: 10,
  isEnabled: true,
};

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface TestSuiteDetailPanelProps {
  suite: TestSuite | null;
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isCreateMode?: boolean;
}

export function TestSuiteDetailPanel({
  suite,
  agentId,
  open,
  onOpenChange,
  isCreateMode = false,
}: TestSuiteDetailPanelProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DetailTab>("general");
  const [formState, setFormState] = useState(DEFAULT_TEST_SUITE_FORM);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isCreatingCase, setIsCreatingCase] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [draggingCaseId, setDraggingCaseId] = useState<string | null>(null);
  const [caseOrder, setCaseOrder] = useState<string[]>([]);

  const isEditMode = !!suite && !isCreateMode;

  const { data: judgeModelsData } = useQuery({
    queryKey: ["models", "chat"],
    queryFn: async () => {
      const res = await api.listModels({ type: "chat" });
      return res.models;
    },
    enabled: open,
  });

  const judgeModels = judgeModelsData ?? [];

  const suiteId = suite?.id ?? "";

  const { data: testCases, isLoading: isCasesLoading } = useTestCases(suiteId);
  const createCaseMutation = useCreateTestCase(suiteId);
  const updateCaseMutation = useUpdateTestCase();
  const deleteCaseMutation = useDeleteTestCase(suiteId);
  const reorderCaseMutation = useReorderTestCases(suiteId);

  useEffect(() => {
    if (open) {
      setHasUnsavedChanges(false);
      setActiveTab("general");
      setIsCreatingCase(false);
      setIsImportDialogOpen(false);
      setEditingCaseId(null);
      setDraggingCaseId(null);

      if (suite) {
        setFormState({
          name: suite.name,
          description: suite.description ?? "",
          scheduleType: suite.scheduleType,
          scheduleTime: suite.scheduleTime ?? "",
          scheduleDayOfWeek:
            suite.scheduleDayOfWeek !== null ? String(suite.scheduleDayOfWeek) : "",
          llmJudgeModelConfigId: suite.llmJudgeModelConfigId ?? "",
          alertOnRegression: suite.alertOnRegression,
          alertThresholdPercent: suite.alertThresholdPercent,
          isEnabled: suite.isEnabled,
        });
      } else {
        setFormState(DEFAULT_TEST_SUITE_FORM);
      }
    }
  }, [open, suite]);

  useEffect(() => {
    if (testCases) {
      const sorted = [...testCases].sort((a, b) => a.sortOrder - b.sortOrder);
      setCaseOrder(sorted.map((item) => item.id));
    }
  }, [testCases]);

  const updateField = (updates: Partial<typeof formState>) => {
    setFormState((prev) => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  };

  const errors = useMemo(() => {
    const issues: Record<string, string> = {};

    if (!formState.name.trim()) {
      issues.name = "Name is required.";
    }

    if (formState.scheduleType === "daily" || formState.scheduleType === "weekly") {
      if (!formState.scheduleTime) {
        issues.scheduleTime = "Select a schedule time.";
      }
    }

    if (formState.scheduleType === "weekly" && formState.scheduleDayOfWeek === "") {
      issues.scheduleDayOfWeek = "Select a day of the week.";
    }

    if (formState.alertOnRegression) {
      const threshold = Number(formState.alertThresholdPercent);
      if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) {
        issues.alertThresholdPercent = "Threshold must be between 1 and 100.";
      }
    }

    return issues;
  }, [formState]);

  const isValid = Object.keys(errors).length === 0;

  const orderedCases = useMemo(() => {
    if (!testCases) return [] as TestCase[];
    const map = new Map(testCases.map((item) => [item.id, item]));
    if (caseOrder.length === 0) {
      return [...testCases].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return caseOrder.map((id) => map.get(id)).filter(Boolean) as TestCase[];
  }, [caseOrder, testCases]);

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.createTestSuite>[1]) =>
      api.createTestSuite(agentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-suites", agentId] });
      onOpenChange(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.updateTestSuite>[1]) =>
      api.updateTestSuite(suite!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-suites", agentId] });
      setHasUnsavedChanges(false);
    },
  });

  const handleSave = () => {
    if (!isValid) return;

    const payload = {
      name: formState.name.trim(),
      description: formState.description.trim() || undefined,
      scheduleType: formState.scheduleType,
      scheduleTime:
        formState.scheduleType === "daily" || formState.scheduleType === "weekly"
          ? formState.scheduleTime
          : undefined,
      scheduleDayOfWeek:
        formState.scheduleType === "weekly" && formState.scheduleDayOfWeek !== ""
          ? Number(formState.scheduleDayOfWeek)
          : undefined,
      llmJudgeModelConfigId: formState.llmJudgeModelConfigId || undefined,
      alertOnRegression: formState.alertOnRegression,
      alertThresholdPercent: Number(formState.alertThresholdPercent),
      isEnabled: formState.isEnabled,
    };

    if (isCreateMode) {
      createMutation.mutate(payload);
    } else if (suite) {
      updateMutation.mutate(payload);
    }
  };

  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error || updateMutation.error;
  const isCaseMutationPending =
    createCaseMutation.isPending || updateCaseMutation.isPending || deleteCaseMutation.isPending;

  const renderModelOptionLabel = (model: ModelConfiguration) => {
    const providerName = model.provider?.displayName;
    if (providerName) {
      return `${model.displayName} (${providerName})${model.isDefault ? " - Default" : ""}`;
    }
    return `${model.displayName}${model.isDefault ? " - Default" : ""}`;
  };

  const buildDefaultCaseValues = (): TestCaseFormValues => ({
    name: "",
    description: "",
    question: "",
    expectedBehavior: DEFAULT_EXPECTED_BEHAVIOR,
    isEnabled: true,
  });

  const handleCreateCase = (values: TestCaseFormValues) => {
    if (!suiteId) return;
    const maxSortOrder = orderedCases.length > 0 ? Math.max(...orderedCases.map((item) => item.sortOrder)) : 0;
    createCaseMutation.mutate(
      {
        name: values.name,
        description: values.description || undefined,
        question: values.question,
        expectedBehavior: values.expectedBehavior,
        sortOrder: orderedCases.length > 0 ? maxSortOrder + 1 : 0,
      },
      {
        onSuccess: () => {
          setIsCreatingCase(false);
        },
      }
    );
  };

  const handleUpdateCase = (caseId: string, values: TestCaseFormValues) => {
    updateCaseMutation.mutate(
      {
        caseId,
        data: {
          name: values.name,
          description: values.description || undefined,
          question: values.question,
          expectedBehavior: values.expectedBehavior,
          isEnabled: values.isEnabled,
        },
      },
      {
        onSuccess: () => setEditingCaseId(null),
      }
    );
  };

  const handleDeleteCase = (testCase: TestCase) => {
    deleteCaseMutation.mutate(testCase.id);
  };

  const handleDragStart = (caseId: string) => {
    if (isCreatingCase || editingCaseId) return;
    setDraggingCaseId(caseId);
  };

  const handleDrop = (targetId: string) => {
    if (!draggingCaseId || draggingCaseId === targetId) {
      setDraggingCaseId(null);
      return;
    }

    const currentOrder = caseOrder.length
      ? caseOrder
      : orderedCases.map((item) => item.id);
    const fromIndex = currentOrder.indexOf(draggingCaseId);
    const toIndex = currentOrder.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggingCaseId(null);
      return;
    }

    const nextOrder = [...currentOrder];
    const [moved] = nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, moved);
    setCaseOrder(nextOrder);
    reorderCaseMutation.mutate(nextOrder);
    setDraggingCaseId(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl p-0 flex flex-col"
      >
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="text-lg">
            {isCreateMode ? "Create Test Suite" : suite?.name || "Test Suite"}
          </SheetTitle>
          {!isCreateMode && suite && (
            <SheetDescription className="text-sm">
              {suite.testCaseCount} case{suite.testCaseCount !== 1 ? "s" : ""} ·
              {suite.isEnabled ? " Enabled" : " Disabled"}
            </SheetDescription>
          )}
        </SheetHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as DetailTab)}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <TabsList className="mx-6 mt-4 grid w-auto grid-cols-4">
            <TabsTrigger value="general" className="gap-2">
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">General</span>
            </TabsTrigger>
            <TabsTrigger value="schedule" className="gap-2">
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Schedule</span>
            </TabsTrigger>
            <TabsTrigger value="evaluation" className="gap-2">
              <AlertCircle className="w-4 h-4" />
              <span className="hidden sm:inline">Evaluation</span>
            </TabsTrigger>
            <TabsTrigger value="cases" className="gap-2">
              <ListChecks className="w-4 h-4" />
              <span className="hidden sm:inline">Test Cases</span>
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <TabsContent value="general" className="mt-0 h-full">
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input
                    value={formState.name}
                    onChange={(event) => updateField({ name: event.target.value })}
                    placeholder="QA Regression Suite"
                  />
                  {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={formState.description}
                    onChange={(event) => updateField({ description: event.target.value })}
                    placeholder="What this suite validates..."
                    rows={3}
                  />
                </div>

                <div className="flex items-center justify-between p-3 border border-border rounded-lg">
                  <div>
                    <Label className="text-sm">Suite Enabled</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Disabled suites will not run on schedule.
                    </p>
                  </div>
                  <Switch
                    checked={formState.isEnabled}
                    onCheckedChange={(checked) => updateField({ isEnabled: checked })}
                  />
                </div>

                {isEditMode && suite && (
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <h4 className="text-sm font-medium mb-3">Suite Info</h4>
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Created</dt>
                        <dd>{new Date(suite.createdAt).toLocaleDateString()}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Suite ID</dt>
                        <dd className="font-mono text-xs">{suite.id}</dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="schedule" className="mt-0 h-full">
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label>Schedule Type</Label>
                  <Select
                    value={formState.scheduleType}
                    onValueChange={(value: TestSuite["scheduleType"]) => {
                      const next = { scheduleType: value };
                      if (value === "manual" || value === "hourly") {
                        updateField({ ...next, scheduleTime: "", scheduleDayOfWeek: "" });
                      } else if (value === "daily") {
                        updateField({ ...next, scheduleDayOfWeek: "" });
                      } else {
                        updateField(next);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose schedule" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual only</SelectItem>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Scheduled suites run automatically in the background.
                  </p>
                </div>

                {(formState.scheduleType === "daily" || formState.scheduleType === "weekly") && (
                  <div className="space-y-2">
                    <Label>Run Time</Label>
                    <Input
                      type="time"
                      value={formState.scheduleTime}
                      onChange={(event) => updateField({ scheduleTime: event.target.value })}
                    />
                    {errors.scheduleTime && (
                      <p className="text-xs text-destructive">{errors.scheduleTime}</p>
                    )}
                  </div>
                )}

                {formState.scheduleType === "weekly" && (
                  <div className="space-y-2">
                    <Label>Day of Week</Label>
                    <Select
                      value={formState.scheduleDayOfWeek}
                      onValueChange={(value) => updateField({ scheduleDayOfWeek: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select day" />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS_OF_WEEK.map((day, index) => (
                          <SelectItem key={day} value={String(index)}>
                            {day}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.scheduleDayOfWeek && (
                      <p className="text-xs text-destructive">{errors.scheduleDayOfWeek}</p>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="evaluation" className="mt-0 h-full">
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label>LLM Judge Model</Label>
                  {judgeModels.length > 0 ? (
                    <Select
                      value={formState.llmJudgeModelConfigId || "none"}
                      onValueChange={(value) =>
                        updateField({ llmJudgeModelConfigId: value === "none" ? "" : value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No LLM judge</SelectItem>
                        {judgeModels.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {renderModelOptionLabel(model)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground p-3 bg-muted rounded-lg">
                      No chat models configured. Add one to enable LLM judge checks.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    The LLM judge evaluates open-ended criteria for complex test cases.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 border border-border rounded-lg">
                    <div>
                      <Label className="text-sm">Regression Alerts</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Notify alert recipients when pass rate drops.
                      </p>
                    </div>
                    <Switch
                      checked={formState.alertOnRegression}
                      onCheckedChange={(checked) => updateField({ alertOnRegression: checked })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Alert Threshold (%)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={formState.alertThresholdPercent}
                      onChange={(event) =>
                        updateField({ alertThresholdPercent: Number(event.target.value) })
                      }
                      disabled={!formState.alertOnRegression}
                    />
                    {errors.alertThresholdPercent && (
                      <p className="text-xs text-destructive">{errors.alertThresholdPercent}</p>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="cases" className="mt-0 h-full">
              {!isEditMode || !suite ? (
                <div className="space-y-4">
                  <div className="p-4 border border-dashed rounded-lg text-center text-sm text-muted-foreground">
                    Create the suite first, then add test cases.
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Test cases support structured expectations, semantic similarity checks, and LLM judge criteria.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Test Cases</p>
                      <p className="text-xs text-muted-foreground">
                        {orderedCases.length} case{orderedCases.length !== 1 ? "s" : ""} in this suite.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => setIsImportDialogOpen(true)}
                      >
                        <Plus className="h-4 w-4" />
                        Import JSONL
                      </Button>
                      {!isCreatingCase && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => setIsCreatingCase(true)}
                        >
                          <Plus className="h-4 w-4" />
                          Add Case
                        </Button>
                      )}
                    </div>
                  </div>

                  <ImportTestCasesDialog
                    suiteId={suiteId}
                    open={isImportDialogOpen}
                    onOpenChange={setIsImportDialogOpen}
                  />

                  {isCreatingCase && (
                    <div className="border border-border rounded-lg p-4 bg-muted/20">
                      <TestCaseForm
                        initialValues={buildDefaultCaseValues()}
                        submitLabel="Create Test Case"
                        onSubmit={handleCreateCase}
                        onCancel={() => setIsCreatingCase(false)}
                        disabled={isCaseMutationPending}
                      />
                    </div>
                  )}

                  {isCasesLoading ? (
                    <LoadingSkeleton variant="card" count={3} />
                  ) : orderedCases.length === 0 ? (
                    <EmptyState
                      title="No test cases yet"
                      description="Add a test case to start validating agent responses."
                      action={{
                        label: "Add test case",
                        onClick: () => setIsCreatingCase(true),
                      }}
                    />
                  ) : (
                    <div className="space-y-4">
                      {orderedCases.map((testCase) => {
                        if (editingCaseId === testCase.id) {
                          return (
                            <div key={testCase.id} className="border border-border rounded-lg p-4 bg-muted/20">
                              <TestCaseForm
                                initialValues={{
                                  name: testCase.name,
                                  description: testCase.description ?? "",
                                  question: testCase.question,
                                  expectedBehavior: testCase.expectedBehavior,
                                  isEnabled: testCase.isEnabled,
                                }}
                                submitLabel="Save Changes"
                                onSubmit={(values) => handleUpdateCase(testCase.id, values)}
                                onCancel={() => setEditingCaseId(null)}
                                disabled={isCaseMutationPending}
                              />
                            </div>
                          );
                        }

                        return (
                          <TestCaseCard
                            key={testCase.id}
                            testCase={testCase}
                            onEdit={(selected) => setEditingCaseId(selected.id)}
                            onDelete={handleDeleteCase}
                            isDragging={draggingCaseId === testCase.id}
                            dragItemProps={{
                              draggable: !isCreatingCase && !editingCaseId,
                              onDragStart: () => handleDragStart(testCase.id),
                              onDragOver: (event) => {
                                event.preventDefault();
                              },
                              onDrop: (event) => {
                                event.preventDefault();
                                handleDrop(testCase.id);
                              },
                              onDragEnd: () => setDraggingCaseId(null),
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        {error && (
          <div className="mx-6 mb-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error.message}</p>
          </div>
        )}

        <div className="px-6 py-4 border-t bg-background flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {hasUnsavedChanges && !pending && "Unsaved changes"}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={pending || !isValid}>
              {pending ? "Saving..." : isCreateMode ? "Create Suite" : "Save Changes"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
