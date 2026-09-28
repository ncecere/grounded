/* Grouping a newest-first list by the local day of its dates (Today, Yesterday, then the date). */
import { startOfDay } from "@/components/ui/calendar/calendar";

export type DayGroup<T> = { key: string; label: string; items: T[] };

/** Groups items (newest first) by the local day of `updatedAt`. */
export function groupByDay<T extends { updatedAt: string }>(items: T[], now = new Date()): DayGroup<T>[] {
  const today = startOfDay(now).getTime();
  const day = 86_400_000;
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const d = startOfDay(new Date(item.updatedAt));
    const key = d.toDateString();
    let group = groups.find((g) => g.key === key);
    if (!group) {
      const t = d.getTime();
      const label =
        t === today
          ? "Today"
          : t === today - day
            ? "Yesterday"
            : d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
      group = { key, label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
