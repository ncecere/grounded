import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { ExpectedBehaviorEditor, DEFAULT_EXPECTED_BEHAVIOR } from "./ExpectedBehaviorEditor";
import type { ExpectedBehavior } from "../../lib/api";

export const DEFAULT_TEST_CASE_FORM = {
  name: "",
  description: "",
  question: "",
  expectedBehavior: DEFAULT_EXPECTED_BEHAVIOR,
  isEnabled: true,
};

export interface TestCaseFormValues {
  name: string;
  description: string;
  question: string;
  expectedBehavior: ExpectedBehavior;
  isEnabled: boolean;
}

interface TestCaseFormProps {
  initialValues?: Partial<TestCaseFormValues>;
  onSubmit: (values: TestCaseFormValues) => void;
  onCancel?: () => void;
  submitLabel?: string;
  disabled?: boolean;
}

const buildInitialValues = (initialValues?: Partial<TestCaseFormValues>): TestCaseFormValues => ({
  name: initialValues?.name ?? DEFAULT_TEST_CASE_FORM.name,
  description: initialValues?.description ?? DEFAULT_TEST_CASE_FORM.description,
  question: initialValues?.question ?? DEFAULT_TEST_CASE_FORM.question,
  expectedBehavior: initialValues?.expectedBehavior ?? DEFAULT_TEST_CASE_FORM.expectedBehavior,
  isEnabled: initialValues?.isEnabled ?? DEFAULT_TEST_CASE_FORM.isEnabled,
});

export function TestCaseForm({
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
  disabled = false,
}: TestCaseFormProps) {
  const [formState, setFormState] = useState<TestCaseFormValues>(() => buildInitialValues(initialValues));

  useEffect(() => {
    setFormState(buildInitialValues(initialValues));
  }, [initialValues]);

  const updateField = (updates: Partial<TestCaseFormValues>) => {
    setFormState((prev) => ({ ...prev, ...updates }));
  };

  const errors = useMemo(() => {
    const issues: Record<string, string> = {};
    if (!formState.name.trim()) {
      issues.name = "Name is required.";
    }
    if (!formState.question.trim()) {
      issues.question = "Question is required.";
    }
    return issues;
  }, [formState]);

  const isValid = Object.keys(errors).length === 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid || disabled) return;

    onSubmit({
      name: formState.name.trim(),
      description: formState.description.trim(),
      question: formState.question.trim(),
      expectedBehavior: formState.expectedBehavior,
      isEnabled: formState.isEnabled,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Name *</Label>
          <Input
            value={formState.name}
            onChange={(event) => updateField({ name: event.target.value })}
            placeholder="Checkout refund policy"
            disabled={disabled}
          />
          {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
        </div>

        <div className="space-y-2">
          <Label>Description</Label>
          <Input
            value={formState.description}
            onChange={(event) => updateField({ description: event.target.value })}
            placeholder="Optional context"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Question *</Label>
        <Textarea
          value={formState.question}
          onChange={(event) => updateField({ question: event.target.value })}
          placeholder="Ask the agent to explain the refund policy."
          rows={4}
          disabled={disabled}
        />
        {errors.question && <p className="text-xs text-destructive">{errors.question}</p>}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between border border-border rounded-lg p-3">
          <div>
            <Label className="text-sm">Case Enabled</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Disabled cases are ignored during suite runs.
            </p>
          </div>
          <Switch
            checked={formState.isEnabled}
            onCheckedChange={(checked) => updateField({ isEnabled: checked })}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <Label>Expected Behavior</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Define how the response should be evaluated for this test case.
          </p>
        </div>
        <ExpectedBehaviorEditor
          value={formState.expectedBehavior}
          onChange={(expectedBehavior) => updateField({ expectedBehavior })}
          disabled={disabled}
        />
      </div>

      <div className="flex justify-end gap-3">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!isValid || disabled}>
          {submitLabel ?? "Save Test Case"}
        </Button>
      </div>
    </form>
  );
}
