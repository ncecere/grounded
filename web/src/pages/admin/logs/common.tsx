/* Shared by the Logs tabs: the person and agent options, the date facet's API window, and CSV export. */
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { Button } from "@/components/ui/button/button";
import type { FacetOption, FilterValues } from "@/components/ui/filter-bar/filter-bar";
import type { DateRangeSelection } from "@/components/ui/date-picker/date-picker";
import { toast } from "@/components/ui/toast/toast";
import { adminAgentsQuery } from "../agents/agents";

export { one } from "../hooks";

/** Everyone who has signed in, as filter options (the first 200 by email). */
export function usePeopleOptions(): FacetOption[] {
  const users = useQuery({
    queryKey: ["admin", "users", "options"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/users", { params: { query: { limit: 200 } } })),
    staleTime: 60_000,
  });
  return (users.data?.items ?? []).map((u) => ({ value: u.id, label: u.displayName ? `${u.displayName} (${u.email})` : u.email }));
}

/** Every agent, as filter options grouped by team. */
export function useAgentOptions(): FacetOption[] {
  const agents = useQuery({ ...adminAgentsQuery(), staleTime: 60_000 });
  return (agents.data ?? []).map((a) => ({ value: a.id, label: a.name, group: a.teamName }));
}

/** The date facet as an RFC 3339 window [from, to), local days. */
export function rangeWindow(values: FilterValues, id = "range"): { from?: string; to?: string } {
  const sel = values[id] as DateRangeSelection | undefined;
  const r = sel && !Array.isArray(sel) ? sel.range : null;
  if (!r) return {};
  const start = new Date(r.from.getFullYear(), r.from.getMonth(), r.from.getDate());
  const last = r.to ?? r.from;
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Quotes a CSV field when needed (RFC 4180). */
export const csvField = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCSV = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";

/** Most rows one export reads (pages of 200). */
export const exportCap = 10_000;

type Page<T> = { items: T[]; nextCursor?: string | null };

/**
 * An "Export CSV" button: reads every page with the current filters (up to
 * exportCap rows) and downloads them.
 */
export function ExportButton<T>({ fetchPage, header, row, filename }: { fetchPage: (cursor?: string) => Promise<Page<T>>; header: string[]; row: (e: T) => unknown[]; filename: string }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const all: T[] = [];
      let cursor: string | undefined;
      do {
        const page = await fetchPage(cursor);
        all.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && all.length < exportCap);
      const blob = new Blob([toCSV(header, all.slice(0, exportCap).map(row))], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        all.length > exportCap ? `Exported the first ${exportCap.toLocaleString()} entries` : `Exported ${all.length.toLocaleString()} ${all.length === 1 ? "entry" : "entries"}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't export the log");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={() => void run()}>
      <Download aria-hidden /> Export CSV
    </Button>
  );
}
