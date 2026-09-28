/*
 * A create or edit form in a large side sheet (D4): catalog records are
 * edited beside the list, not in a centred dialog. Closing it after an edit
 * asks "Leave without saving?" (m7).
 */
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button/button";
import { Form } from "@/components/ui/field/field";
import { GuardedSheet, useEditTracker } from "@/components/templates/close-guard";
import { SheetClose } from "@/components/ui/sheet/sheet";
import m from "./models.module.css";

type Props = {
  title: ReactNode;
  description: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: ReactNode;
  busy?: boolean;
  submitDisabled?: boolean;
  children: ReactNode;
};

export function SheetForm({ title, description, onClose, onSubmit, submitLabel, busy, submitDisabled, children }: Props) {
  const formId = useId();
  const edits = useEditTracker();
  return (
    <GuardedSheet
      dirty={edits.edited && !busy}
      onClose={onClose}
      size="lg"
      title={title}
      description={description}
      footer={
        <>
          <SheetClose>Cancel</SheetClose>
          <Button type="submit" form={formId} loading={busy} disabled={submitDisabled}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <Form
        {...edits.formProps}
        id={formId}
        className={m.sheetForm}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </Form>
    </GuardedSheet>
  );
}

/** A titled group of fields inside a SheetForm. */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className={m.formSection}>
      <legend className={m.formSectionTitle}>{title}</legend>
      <div className={m.formSectionBody}>{children}</div>
    </fieldset>
  );
}
