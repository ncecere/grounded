/*
 * The documents table's selection and refresh rules.
 *
 * Selection follows what the table shows (BU-04): a row that a filter, a
 * search or another page hides is no longer selected, so the bulk bar's
 * count, the footer and the Delete dialog always agree, and Delete acts on
 * exactly the rows it names. New filters or another page start with nothing
 * selected.
 *
 * A filtered list refreshes when the source's document counts change
 * (BU-11): a document retried from the Failed view leaves it while it's
 * queued, and comes back when it fails again, without switching filters.
 */
import { useEffect, useRef, useState } from "react";

export type VisibleSelection = {
  /** The selected rows that are on screen: what the bulk bar counts and acts on. */
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  /** Forgets these rows (deleted ones). */
  drop: (ids: string[]) => void;
};

/** Selected ids limited to the visible rows; cleared whenever `resetKey` (the filters and page) changes. */
export function useVisibleSelection(visibleIds: string[], resetKey: string): VisibleSelection {
  const [selected, setSelected] = useState<string[]>([]);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    // Reset during render (not in an effect) so no frame shows the old selection under new filters.
    setKey(resetKey);
    setSelected([]);
  }
  const visible = new Set(visibleIds);
  const shown = key === resetKey ? selected.filter((id) => visible.has(id)) : [];
  const stale = shown.length !== selected.length;
  // Rows that left the view (a refresh moved them out of the filter) are forgotten, so they don't come back selected.
  useEffect(() => {
    if (stale) setSelected((s) => s.filter((id) => visible.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `visible` is derived from visibleIds on every render
  }, [stale]);
  return {
    selectedIds: shown,
    onSelectionChange: (ids) => setSelected(ids.filter((id) => visible.has(id))),
    drop: (ids) => setSelected((s) => s.filter((id) => !ids.includes(id))),
  };
}

/** The source's document counts as one string: it changes when a document finishes, fails or is added or removed. */
export function countsSignature(c: { total: number; pending: number; processing: number; ready: number; failed: number; skipped: number }) {
  return [c.total, c.pending, c.processing, c.ready, c.failed, c.skipped].join(",");
}

/** Calls `refresh` when `signature` changes after the first render. */
export function useRefreshOnChange(signature: string, refresh: () => void) {
  const last = useRef(signature);
  useEffect(() => {
    if (last.current === signature) return;
    last.current = signature;
    refresh();
  }, [signature, refresh]);
}
