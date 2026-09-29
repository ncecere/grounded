/*
 * The admin sidebar's groups collapse to their headers (docs/v0.2.0.md §7):
 * the group of the current page opens by itself, the others stay as the
 * person left them (remembered in this browser); Overview has no group.
 * Only groups opened by hand are remembered: a group that opened because its
 * page was current closes again when the person moves on, so open groups
 * don't pile up and push the current item out of view (v0.2.1 walkthrough).
 * Groups are remembered by label: labels from before the v0.2.1 regroup (I1)
 * open their new groups, and labels that no longer exist are forgotten.
 */
import { useCallback, useState } from "react";
import { adminSections, oldAdminGroups } from "./nav";

const storageKey = "grounded.adminNavOpen";

/** The remembered open groups that exist now: old labels become their new groups, unknown ones are dropped. */
export function currentGroups(saved: string[]): string[] {
  const known = new Set(adminSections.flatMap((s) => (s.label ? [s.label] : [])));
  return [...new Set(saved.flatMap((l) => oldAdminGroups[l] ?? [l]))].filter((l) => known.has(l));
}

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? "[]");
    const saved = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    const now = currentGroups(saved);
    if (now.join("\n") !== saved.join("\n")) write(now);
    return now;
  } catch {
    return [];
  }
}

function write(open: string[]) {
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(open));
  } catch {
    // Storage can be unavailable (private mode).
  }
}

/**
 * Which admin groups are open: the ones the person opened by hand (remembered), plus the current page's
 * group. That one opens by itself without being remembered, so leaving the page closes it again unless
 * it was opened by hand; closing it by hand hides it until the page is in another group.
 */
export function useAdminGroups(active: string | undefined) {
  const [saved, setSaved] = useState<string[]>(read);
  const [closed, setClosed] = useState<{ active: string | undefined; closed: boolean }>({ active, closed: false });
  // A state update during render: arriving in another group forgets that the last one was closed by hand.
  if (closed.active !== active) setClosed({ active, closed: false });
  const activeClosed = closed.active === active && closed.closed;
  const setOpen = useCallback(
    (label: string, isOpen: boolean) => {
      if (label === active) setClosed({ active, closed: !isOpen });
      setSaved((list) => {
        const next = isOpen ? [...list.filter((l) => l !== label), label] : list.filter((l) => l !== label);
        write(next);
        return next;
      });
    },
    [active],
  );
  return { isOpen: (label: string) => (label === active ? !activeClosed : saved.includes(label)), setOpen };
}
