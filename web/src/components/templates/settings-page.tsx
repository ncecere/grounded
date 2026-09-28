/*
 * SettingsPage (D3): a settings tab or page as sections in one form, with
 * ONE sticky save bar and the unsaved-changes guard built in (F-17).
 *
 *   <SettingsPage dirty={changed} saving={save.isPending} error={save.error}
 *     onSave={() => save.mutate(form)} onDiscard={reset}>
 *     <SettingsSection title="General">…fields…</SettingsSection>
 *     <SettingsSection title="Crawling">…</SettingsSection>
 *     <DangerZone>
 *       <DangerAction title="Delete this source" description="…"
 *         action={<Button variant="danger" onClick={…}>Delete source</Button>} />
 *     </DangerZone>
 *   </SettingsPage>
 *
 * Danger-zone buttons act on their own (with a confirmation); they're not
 * part of the save. Give them type="button" (bitop's Button's default).
 */
import type { FormEvent, ReactNode } from "react";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Form } from "@/components/ui/field/field";
import { SaveBar } from "@/components/ui/save-bar/save-bar";
import { terms } from "@/lib/terms";
import styles from "./templates.module.css";
import { type UnsavedGuardOptions, useUnsavedChangesGuard } from "./unsaved-guard";

export type SettingsPageProps = {
  /** The form differs from what's saved: shows the save bar and arms the guard. */
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saving?: boolean;
  /** The save failed. Shown above the save bar. */
  error?: unknown;
  /** Save button text (default "Save changes"). */
  saveLabel?: string;
  /** Save bar text (default "Unsaved changes"); e.g. "Not saved: fix the highlighted field". */
  message?: ReactNode;
  /** Viewers who can't edit get no save bar (and no guard). */
  canEdit?: boolean;
  /** Disable Save, e.g. while a field is invalid. */
  saveDisabled?: boolean;
  guard?: UnsavedGuardOptions;
  children: ReactNode;
  className?: string;
};

export function SettingsPage({
  dirty,
  onSave,
  onDiscard,
  saving = false,
  error,
  saveLabel = "Save changes",
  message,
  canEdit = true,
  saveDisabled = false,
  guard,
  children,
  className,
}: SettingsPageProps) {
  const open = canEdit && dirty;
  const dialog = useUnsavedChangesGuard(open, guard);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (open && !saving && !saveDisabled) onSave();
  };
  return (
    <Form noValidate onSubmit={submit} className={className ?? styles.settings}>
      {children}
      {open && Boolean(error) && <ErrorAlert error={error} title="Couldn't save the changes" />}
      <SaveBar open={open} message={message}>
        <Button variant="ghost" disabled={saving} onClick={onDiscard}>
          Discard
        </Button>
        <Button type="submit" loading={saving} disabled={saveDisabled}>
          {saveLabel}
        </Button>
      </SaveBar>
      {dialog}
    </Form>
  );
}

export type SettingsSectionProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Controls in the section header, e.g. a "Test" button. */
  actions?: ReactNode;
  id?: string;
  children: ReactNode;
};

/** One titled group of settings (General, Crawling, …). */
export function SettingsSection({ title, description, actions, id, children }: SettingsSectionProps) {
  return (
    <Card id={id} title={title} description={description} actions={actions}>
      <div className={styles.sectionBody}>{children}</div>
    </Card>
  );
}

/** The last section: irreversible or disruptive actions, each with its own confirmation. */
export function DangerZone({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <Card title={terms.dangerZone} description={description} className={styles.dangerZone}>
      <div className={styles.dangerList}>{children}</div>
    </Card>
  );
}

export type DangerActionProps = {
  title: ReactNode;
  description: ReactNode;
  /** The button, e.g. <Button variant="danger">Delete source</Button>. Disable it with a reason when it can't run. */
  action: ReactNode;
  /** Why the action is unavailable (P-04), shown under the description. */
  disabledReason?: ReactNode;
};

export function DangerAction({ title, description, action, disabledReason }: DangerActionProps) {
  return (
    <div className={styles.dangerRow}>
      <div className={styles.dangerText}>
        <h3 className={styles.dangerTitle}>{title}</h3>
        <p className={styles.dangerDescription}>{description}</p>
        {disabledReason && <p className={styles.dangerReason}>{disabledReason}</p>}
      </div>
      <div className={styles.dangerButton}>{action}</div>
    </div>
  );
}
