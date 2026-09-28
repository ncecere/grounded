/*
 * Agent accent colours: data values, not styling. An accent is stored per
 * agent ("#rrggbb", "" for the default) and always carries white text, so
 * the API requires 4.5:1 against white. This is the only place in src/ with
 * literal colours: the styling check (scripts/check-styling.mjs) allows
 * literal colours in *.colors.ts data files and nowhere else.
 */

/** The text colour drawn on every accent. */
export const ACCENT_TEXT = "#ffffff";

/** Used when an agent has no accent (a deep blue that passes 11.9:1 with white text). */
export const DEFAULT_ACCENT = "#0021a5";

/** Quick picks in the Appearance tab; each passes 4.5:1 with white text. */
export const ACCENT_PRESETS = [
  { value: "#0021a5", label: "Royal blue" },
  { value: "#1d4f91", label: "Navy" },
  { value: "#22668d", label: "Teal" },
  { value: "#1b5e20", label: "Green" },
  { value: "#6a1b9a", label: "Purple" },
  { value: "#8a1c1c", label: "Red" },
  { value: "#343741", label: "Charcoal" },
];
