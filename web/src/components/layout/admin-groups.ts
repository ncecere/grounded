/*
 * The admin sidebar's groups collapse to their headers (docs/v0.2.0.md §7):
 * the group of the current page opens by itself, the others stay as the
 * person left them (remembered in this browser); Overview has no group.
 * Groups are remembered by label: labels from before the v0.2.1 regroup (I1)
 * open their new groups, and labels that no longer exist are forgotten.
 */
import { useCallback, useEffect, useState } from "react";
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

/** Which admin groups are open: the remembered ones, plus the current page's group. */
export function useAdminGroups(active: string | undefined) {
  const [open, setOpenList] = useState<string[]>(() => {
    const saved = read();
    return active && !saved.includes(active) ? [...saved, active] : saved;
  });
  // Arriving on a page of a closed group opens it.
  useEffect(() => {
    if (!active) return;
    setOpenList((list) => {
      if (list.includes(active)) return list;
      const next = [...list, active];
      write(next);
      return next;
    });
  }, [active]);
  const setOpen = useCallback((label: string, isOpen: boolean) => {
    setOpenList((list) => {
      const next = isOpen ? [...list.filter((l) => l !== label), label] : list.filter((l) => l !== label);
      write(next);
      return next;
    });
  }, []);
  return { isOpen: (label: string) => open.includes(label), setOpen };
}
