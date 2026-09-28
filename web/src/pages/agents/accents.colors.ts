/*
 * Agent accent colours: data values, not styling. An accent is stored per
 * agent ("#rrggbb", "" for the default) and always carries white text, so
 * the API requires 4.5:1 against white. This is the only place in src/ with
 * literal colours: the styling check (scripts/check-styling.mjs) allows
 * literal colours in *.colors.ts data files and nowhere else.
 */

/** The text colour drawn on every accent. */
export const ACCENT_TEXT = "#ffffff";

/**
 * Used when an agent has no accent: the theme's primary colour, which the
 * chat, the embed and the widget draw then. This is the neutral theme's
 * (--palette-accent-600, 6.20:1 with white text); themeAccent() reads the
 * installed theme's at run time.
 */
export const DEFAULT_ACCENT = "#4b4fd6";

/** The theme's --color-primary as "#rrggbb" (a brand theme may change it), or DEFAULT_ACCENT. */
export function themeAccent(): string {
  const v = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : DEFAULT_ACCENT;
}

/** Quick picks in the Appearance tab; each passes 4.5:1 with white text. */
export const ACCENT_PRESETS = [
  { value: DEFAULT_ACCENT, label: "Indigo" },
  { value: "#1d4f91", label: "Navy" },
  { value: "#22668d", label: "Teal" },
  { value: "#1b5e20", label: "Green" },
  { value: "#6a1b9a", label: "Purple" },
  { value: "#8a1c1c", label: "Red" },
  { value: "#343741", label: "Charcoal" },
];
