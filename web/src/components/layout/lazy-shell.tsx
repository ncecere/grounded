/*
 * The signed-in shell (sidebar, command palette, search, notifications) as its own chunk: the widget's embed page,
 * shared conversations, public agent pages and the accessibility statement never show it, so it is not in the entry
 * chunk (#252). A signed-in address starts loading it with the entry (preloadShellFor), alongside the session request,
 * so signed-in pages don't wait for it afterwards.
 */
import { type ReactNode, Suspense, lazy } from "react";
import { publicRef } from "../../pages/public/session";

const load = () => import("./shell");
const Shell = lazy(() => load().then((m) => ({ default: m.AppLayout })));

/** Addresses outside the shell: the widget, shared conversations, the accessibility statement and OAuth consent. */
const outside = /^\/(embed|shared|accessibility|oauth)(\/|$)/;

/**
 * Starts loading the shell when the address is one it shows. A public agent's address (/a/…) waits for the session:
 * signed out it is the public page. A signed-out visitor of any other address gets the sign-in page, and the shell
 * loads behind it, which it does not hold up.
 */
export function preloadShellFor(path: string) {
  if (!outside.test(path) && !publicRef(path)) void load();
}

/** The signed-in layout (shell.tsx), with `fallback` while its chunk loads. */
export function AppLayout({ children, fallback }: { children?: ReactNode; fallback: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
