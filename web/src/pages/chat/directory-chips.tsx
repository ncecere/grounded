/*
 * Discover's active filters (v0.4.2 US-13): the team and the search text as
 * chips, and a "Clear all" that clears the search too. bitop-ui's FilterBar
 * shows chips for its facets only, and its Clear all leaves the search input
 * alone (a follow-up for the registry), so Discover draws its own row.
 */
import { X } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button/button";
import type { Facet, FilterValues } from "@/components/ui/filter-bar/filter-bar";
import d from "./directory.module.css";

type Chip = { key: string; facet: string; text: string; remove: () => void };

type Props<T> = {
  facets: Facet<T>[];
  values: FilterValues;
  query: string;
  onValues: (next: FilterValues) => void;
  onQuery: (next: string) => void;
  /** Clears the facets and the search in one change of the address. */
  onClearAll: () => void;
};

/** The chips of the select facets and the search text, then Clear all. */
export function DirectoryChips<T>({ facets, values, query, onValues, onQuery, onClearAll }: Props<T>) {
  const list = useRef<HTMLUListElement>(null);
  const chips: Chip[] = [];
  for (const f of facets) {
    const v = values[f.id];
    if (f.type !== "select" || !Array.isArray(v)) continue;
    for (const value of v) {
      const text = f.options.find((o) => o.value === value)?.label ?? value;
      chips.push({ key: `${f.id}:${value}`, facet: f.label, text, remove: () => onValues({ ...values, [f.id]: v.filter((x) => x !== value) }) });
    }
  }
  if (query.trim()) chips.push({ key: "q", facet: "Search", text: `“${query.trim()}”`, remove: () => onQuery("") });
  if (chips.length === 0) return null;
  // After a chip goes, focus the next one (or Clear all, or the search box when nothing is left).
  const refocus = (i: number) =>
    requestAnimationFrame(() => {
      const buttons = list.current?.querySelectorAll<HTMLElement>("button");
      const next = buttons?.[Math.min(i, buttons.length - 1)];
      (next ?? document.querySelector<HTMLElement>('input[type="search"]'))?.focus();
    });
  const clearAll = () => {
    onClearAll();
    requestAnimationFrame(() => document.querySelector<HTMLElement>('input[type="search"]')?.focus());
  };
  return (
    <ul ref={list} aria-label="Active filters" className={d.chips}>
      {chips.map((c, i) => (
        <li key={c.key}>
          <button
            type="button"
            className={d.chip}
            aria-label={`Remove ${c.facet.toLowerCase()} filter: ${c.text}`}
            onClick={() => {
              c.remove();
              refocus(i);
            }}
          >
            <span className={d.chipFacet}>{c.facet}:</span> {c.text}
            <X aria-hidden className={d.chipIcon} />
          </button>
        </li>
      ))}
      <li>
        <Button size="sm" variant="ghost" onClick={clearAll}>
          Clear all
        </Button>
      </li>
    </ul>
  );
}
