/*
 * The admin sidebar's groups collapse to their headers (docs/v0.2.0.md §7):
 * the group of the current page opens by itself, the others stay as the
 * person left them (remembered in this browser); Overview has no group.
 */
import { useCallback, useEffect, useState } from "react";

const storageKey = "grounded.adminNavOpen";

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
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
