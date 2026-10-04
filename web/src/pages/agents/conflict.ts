/*
 * Save conflicts in the agent editor (docs/ui-review F-04). When a save
 * finds the agent changed elsewhere (412), the editor keeps the user's
 * edits, loads the latest version and asks: "Keep mine" re-applies the
 * user's changes on top of the latest revision, "Use theirs" drops them.
 * Pure helpers, unit-tested.
 */

/** A draft: profile fields and configuration, both flat records. */
export type DraftLike<P, C> = { profile: P; config: C };

/** A save conflict: the draft the user started from, their edits, and the latest version. */
export type Conflict<P, C> = { from: DraftLike<P, C>; mine: DraftLike<P, C>; theirs: DraftLike<P, C> };

/** JSON with object keys sorted, so key order doesn't matter (the server returns its own order: BU-05). */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );
}

/** Equal values, whatever the order of object keys. */
export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** The fields the user changed since `from`, as "profile.x" and "config.y". */
export function changedFields<P extends object, C extends object>(from: DraftLike<P, C>, mine: DraftLike<P, C>): string[] {
  const out: string[] = [];
  for (const part of ["profile", "config"] as const) {
    const a = from[part] as Record<string, unknown>;
    const b = mine[part] as Record<string, unknown>;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[k], b[k])) out.push(`${part}.${k}`);
  }
  return out;
}

/** The latest version with the user's changed fields applied on top ("Keep mine"). */
export function reapply<P extends object, C extends object>(c: Conflict<P, C>): DraftLike<P, C> {
  const next = { profile: { ...c.theirs.profile }, config: { ...c.theirs.config } };
  for (const f of changedFields(c.from, c.mine)) {
    const [part, key] = f.split(".") as ["profile" | "config", string];
    (next[part] as Record<string, unknown>)[key] = (c.mine[part] as Record<string, unknown>)[key];
  }
  return next;
}

/** Fields both sides changed to different values: "Keep mine" overwrites these. */
export function overlapping<P extends object, C extends object>(c: Conflict<P, C>): string[] {
  const theirs = new Set(changedFields(c.from, c.theirs));
  return changedFields(c.from, c.mine).filter((f) => {
    if (!theirs.has(f)) return false;
    const [part, key] = f.split(".") as ["profile" | "config", string];
    return !same((c.mine[part] as Record<string, unknown>)[key], (c.theirs[part] as Record<string, unknown>)[key]);
  });
}
