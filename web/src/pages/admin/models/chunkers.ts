/**
 * The chunkers an embedding profile can use (internal/chunk, `chunker_version`), in one place so the profile form, the profile page and the index
 * preview say the same thing. Versions 2–3 extend their predecessor; version 4 instead preserves explicit boundaries. None of them has been measured on a real knowledge base with a real
 * embedding model: the index preview is how to compare them.
 */
export const CHUNKERS = [
  {
    version: 1,
    label: "Standard: a new passage at every heading",
    short: "Standard",
    previewLabel: "Standard: a new passage at every heading",
    current: "standard chunker",
    help: "Starts a new passage at every heading of level 1 to 3. A table longer than a passage is cut by rows, with its header row repeated.",
  },
  {
    version: 2,
    label: "Merge short sections: joins short neighbouring sections",
    short: "Merge short sections",
    previewLabel: "Merge short sections",
    current: "chunker: merge short sections",
    help: "Does what Standard does, and joins short neighbouring sections into one passage and drops passages that are only a heading.",
  },
  {
    version: 3,
    label: "Keep tables whole: merges short sections and keeps each table together",
    short: "Keep tables whole",
    previewLabel: "Keep tables whole",
    current: "chunker: keep tables whole",
    help: "Does what Merge short sections does, and keeps a table that fits in one passage. A longer table is cut by rows, and every piece repeats the table's caption and header row. No row is lost or repeated, and a row longer than a passage is cut into rows that keep their cells in their own columns.",
  },
  {
    version: 4,
    label: "Structural boundaries: keep labelled sections separate",
    short: "Structural boundaries",
    previewLabel: "Structural boundaries",
    current: "chunker: structural boundaries",
    help: "Keeps table rules, but never merges across headings (levels 1 to 6) or standalone bold labels before top-level lists. Ordinary adjacent prose stays together. Formatting cannot identify procedure changes in unlabelled prose.",
  },
] as const;

/** What the preview says a knowledge base uses now. */
export function chunkerNow(version: number): string {
  return (CHUNKERS.find((c) => c.version === version) ?? CHUNKERS[0]).current;
}

/** The help under the chunker choice: every chunker's one-line description. */
export const CHUNKER_HELP = CHUNKERS.map((c) => `${c.short}: ${c.help}`).join(" ");
