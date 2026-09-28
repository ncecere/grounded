/*
 * FormPage (D4, revised 2026-09-28): a long create or edit form (a source, a
 * model connection, a model, a classification level) opens as a page of its
 * own over its list. Short forms stay in dialogs. The open form is ?form=<value>
 * (useFormParam), so reloading keeps it open and Back closes it. After an
 * edit, leaving any way (Cancel, the back link, the breadcrumb, browser Back,
 * the sidebar, a link) asks "Leave without saving?" first (m7).
 *
 *   const form = useFormParam();
 *   <Button onClick={() => form.open("new")}>New connection</Button>
 *   {form.id && <FormPage label="New connection" title="New connection" description=… onClose={form.close}
 *     onSubmit={() => save.mutate()} submitLabel="Create connection" busy={save.isPending}>…fields…</FormPage>}
 *
 * Mount it while the form is open; `onClose` after a successful save.
 */
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button/button";
import { Card, CardBody } from "@/components/ui/card/card";
import { type DescriptionEntry, DescriptionList } from "@/components/ui/description-list/description-list";
import { Form } from "@/components/ui/field/field";
import { SkeletonText } from "@/components/ui/skeleton/skeleton";
import { useCloseGuard, useEditTracker } from "./close-guard";
import { useRecordParam } from "./record-page";
import { TakeoverPage } from "./takeover";
import { useUnsavedChangesGuard } from "./unsaved-guard";
import styles from "./templates.module.css";

/** The open form's value (?form=): `open(value)` adds a history entry, `close()` goes back. */
export function useFormParam() {
  return useRecordParam("form");
}

export type FormPageProps = {
  /** Plain-text name: the breadcrumb and the page region's name (usually the title). */
  label: string;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: ReactNode;
  busy?: boolean;
  submitDisabled?: boolean;
  /** Show a placeholder instead of the fields (their options are loading). */
  loading?: boolean;
  /** Key facts about the record being edited, in a card above the form. */
  facts?: DescriptionEntry[];
  /** Buttons at the start of the action row: "Back" to an earlier step, or a destructive action. */
  startActions?: ReactNode;
  formRef?: Ref<HTMLFormElement>;
  /** Unsaved edits, when the caller tracks them (default: anything typed or picked since it opened). */
  dirty?: boolean;
  children: ReactNode;
};

export function FormPage({
  label,
  title,
  description,
  onClose,
  onSubmit,
  submitLabel,
  busy,
  submitDisabled,
  loading,
  facts,
  startActions,
  formRef,
  dirty,
  children,
}: FormPageProps) {
  const formId = useId();
  const edits = useEditTracker();
  const unsaved = (dirty ?? edits.edited) && !busy;
  // Closing on purpose (Cancel, the back link, after "Discard changes") turns
  // the navigation guard off first, so it doesn't ask a second time.
  const [leaves, setLeaves] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (leaves > 0) onCloseRef.current();
  }, [leaves]);
  const guard = useCloseGuard(unsaved, () => setLeaves((n) => n + 1));
  // Anything else that leaves (browser Back, the sidebar, a link) asks too.
  const navGuard = useUnsavedChangesGuard(unsaved && leaves === 0, { samePath: true });
  return (
    <TakeoverPage param="form" initialFocus="field" label={label} title={title} description={description} onBack={guard.requestClose}>
      {facts && facts.length > 0 && (
        <Card title="Details" titleAs="h2">
          <DescriptionList items={facts} dividers />
        </Card>
      )}
      <Card>
        <CardBody>
          {loading ? (
            <div role="status" aria-label="Loading…">
              <SkeletonText lines={5} />
            </div>
          ) : (
            <Form
              {...edits.formProps}
              id={formId}
              ref={formRef}
              noValidate
              className={styles.formBody}
              onSubmit={(e) => {
                e.preventDefault();
                // Dialogs opened from inside the form bubble their submit here through the portal.
                if (e.target !== e.currentTarget) return;
                onSubmit();
              }}
            >
              {children}
            </Form>
          )}
        </CardBody>
      </Card>
      <div className={styles.formActions}>
        {startActions && <div className={styles.formActionsStart}>{startActions}</div>}
        <Button variant="secondary" onClick={guard.requestClose}>
          Cancel
        </Button>
        <Button type="submit" form={formId} loading={busy} disabled={submitDisabled || loading}>
          {submitLabel}
        </Button>
      </div>
      {guard.dialog}
      {navGuard}
    </TakeoverPage>
  );
}

/** A titled group of fields inside a FormPage, laid out in two columns. */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className={styles.formSection}>
      <legend className={styles.formSectionTitle}>{title}</legend>
      <div className={styles.formSectionBody}>{children}</div>
    </fieldset>
  );
}
