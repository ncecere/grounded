/*
 * Unsaved input in a sheet or dialog (m7): closing it with Escape, the
 * backdrop, × or Cancel while it holds edits asks "Leave without saving?",
 * like leaving a page with a save bar does (unsaved-guard.tsx). Submitting
 * closes it through onClose directly, without asking.
 *
 *   <GuardedSheet dirty={edited} onClose={onClose} title=… description=… footer=…>…</GuardedSheet>
 *   <RecordSheet dirty={edited} …/>          // RecordSheet uses the same guard
 *
 *   const edits = useEditTracker();          // "has anything been typed or picked?"
 *   <Form {...edits.formProps}>…</Form>      // then dirty={edits.edited}
 */
import { type FormEvent, useCallback, useState } from "react";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Sheet, type SheetProps } from "@/components/ui/sheet/sheet";

/** `requestClose` closes at once, or asks first while `dirty`; render `dialog` inside the sheet or dialog (so it nests). */
export function useCloseGuard(dirty: boolean, onClose: () => void) {
  const [asking, setAsking] = useState(false);
  const requestClose = useCallback(() => (dirty ? setAsking(true) : onClose()), [dirty, onClose]);
  const dialog = (
    <AlertDialog
      open={asking}
      onOpenChange={(o) => !o && setAsking(false)}
      title="Leave without saving?"
      description="What you entered here hasn't been saved. If you close it now, it's discarded."
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      onConfirm={() => {
        setAsking(false);
        onClose();
      }}
    />
  );
  return { requestClose, dialog, asking };
}

/**
 * Whether anything in a form has been typed or picked since it opened: input
 * and change events bubble to the form, so every field counts without
 * wiring each one.
 */
export function useEditTracker() {
  const [edited, setEdited] = useState(false);
  const mark = useCallback((e: FormEvent) => {
    // Only real fields; ignore events from buttons and the like.
    const t = e.target as HTMLElement;
    if (t.matches?.("input, textarea, select, [contenteditable='true']")) setEdited(true);
  }, []);
  return { edited, setEdited, formProps: { onInput: mark, onChange: mark } };
}

export type GuardedSheetProps = Omit<SheetProps, "open" | "defaultOpen" | "onOpenChange"> & {
  /** Default true: the sheet is open while mounted. */
  open?: boolean;
  /** Ask before closing (there are unsaved edits). */
  dirty: boolean;
  onClose: () => void;
};

/** A Sheet whose Escape, backdrop, × and Cancel ask first while it holds unsaved edits. */
export function GuardedSheet({ open = true, dirty, onClose, children, ...props }: GuardedSheetProps) {
  const guard = useCloseGuard(dirty, onClose);
  return (
    <Sheet {...props} open={open} onOpenChange={(o) => !o && guard.requestClose()}>
      {children}
      {guard.dialog}
    </Sheet>
  );
}
