/*
 * Quick actions requested from outside a page (the command palette), such as
 * "New data source". The palette navigates to the page and requests the
 * intent; the page opens its dialog when it is (or becomes) mounted.
 */
import { useEffect, useRef } from "react";

export type Intent = "new-source" | "new-kb" | "new-agent" | "new-api-key" | "new-domain-request" | "new-shared-source" | "add-allowlist" | "add-member";

let pending: Intent | null = null;
const listeners = new Set<(intent: Intent) => void>();

/** Asks the page that handles `intent` to run it (now, or when it mounts). */
export function requestIntent(intent: Intent) {
  pending = intent;
  for (const listener of [...listeners]) listener(intent);
}

/** Runs `handler` when `intent` is requested while this component is mounted, or was requested just before it mounted. */
export function useIntent(intent: Intent, handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const run = (requested: Intent) => {
      if (requested !== intent) return;
      pending = null;
      ref.current();
    };
    if (pending === intent) run(intent);
    listeners.add(run);
    return () => {
      listeners.delete(run);
    };
  }, [intent]);
}
