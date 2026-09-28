/*
 * The last breadcrumb, set by the page: the active tab of a tabbed page
 * ("QA Team › Team settings › Members") or a record's name. The shell's
 * breadcrumbs append it, so the trail always matches what's shown (F-12).
 *
 *   useCrumbTail(tab === tabs[0] ? undefined : "Members");
 *
 * PageTabs and the templates call it for you. Cleared when the page unmounts.
 */
import { useEffect, useSyncExternalStore } from "react";

let tail: string | undefined;
const listeners = new Set<() => void>();

function setTail(next: string | undefined) {
  if (tail === next) return;
  tail = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Sets the breadcrumb tail while the calling component is mounted. */
export function useCrumbTail(label: string | undefined) {
  useEffect(() => {
    setTail(label);
    return () => setTail(undefined);
  }, [label]);
}

/** The current breadcrumb tail (the shell's breadcrumbs). */
export function useCurrentCrumbTail() {
  return useSyncExternalStore(subscribe, () => tail);
}
