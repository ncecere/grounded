/*
 * What changed elsewhere while the person edited a settings form (AD-01),
 * above SettingsPage's save bar. Their edits are still in the form; the save
 * bar offers "Overwrite with mine" and "Discard mine and load theirs".
 */
import { Alert } from "@/components/ui/alert/alert";
import type { ServerChange } from "./revision-form";
import styles from "./templates.module.css";

export const conflictLabels = { overwrite: "Overwrite with mine", discard: "Discard mine and load theirs" } as const;

export function ConflictNotice({ changes }: { changes: ServerChange[] | null }) {
  return (
    <Alert tone="warning" title="Someone else changed these settings while you were editing">
      {changes === null ? (
        <p>Your changes are still in the form. Loading the latest version…</p>
      ) : (
        <>
          <p>
            Your changes are still in the form. <strong>{conflictLabels.overwrite}</strong> saves your version over theirs;{" "}
            <strong>{conflictLabels.discard}</strong> shows theirs instead.
          </p>
          <ul className={styles.conflictList} aria-label="Changed elsewhere">
            {changes.map((c) => (
              <li key={c.key}>
                <span className={styles.conflictField}>{c.label}:</span> now “{c.theirs}”
                {c.clash ? <> (yours: “{c.mine}”)</> : " (you didn't change it, so the form shows theirs)"}
              </li>
            ))}
          </ul>
        </>
      )}
    </Alert>
  );
}
