/*
 * Local midnight of a date. The same as the calendar component's startOfDay (components/ui/calendar), kept here so
 * the helpers the app shell uses (relative-day.ts, group-by-day.ts) don't pull the calendar and its styles into the
 * first chunk.
 */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
