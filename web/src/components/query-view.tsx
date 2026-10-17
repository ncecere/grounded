/* The loading / error / empty / content switch that list cards repeat for every query. */
import { type ReactNode, useEffect, useRef } from "react";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Loading, Spinner } from "@/components/ui/spinner/spinner";
import s from "../pages/shared.module.css";

type QueryViewProps = {
  /** A TanStack Query result (only isLoading and error are read). */
  query: { isLoading: boolean; error: unknown };
  loadingLabel?: string;
  /** Shown instead of the children when truthy, e.g. `list.length === 0 && <EmptyState … />`. */
  empty?: ReactNode;
  children: ReactNode;
};

/**
 * Renders a spinner while the query loads, a padded error alert if it failed,
 * `empty` when given, and the children otherwise. Meant for flush cards:
 * `<Card flush><QueryView …><Table …/></QueryView></Card>`.
 */
export function QueryView({ query, loadingLabel, empty, children }: QueryViewProps) {
  if (query.isLoading) return <Loading label={loadingLabel} />;
  if (query.error) {
    return (
      <div className={s.pad}>
        <ErrorAlert error={query.error} />
      </div>
    );
  }
  return <>{empty || children}</>;
}

const focusable = "a[href], button:not([disabled])";

/**
 * The "Load more" button under a paged list (a TanStack infinite query); nothing when there are no more pages.
 *
 * Focus stays put (#128): the button isn't disabled while it works (a disabled button loses focus, and the page gets it),
 * and when the last page arrives and the button goes away, focus moves to the first of the new rows.
 */
export function LoadMore({ query }: { query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  const box = useRef<HTMLDivElement>(null);
  /** The list around the button and how many of its controls came before the new rows. */
  const resume = useRef<{ scope: Element; before: number } | null>(null);
  const busy = query.isFetchingNextPage;
  // After every render, until the new rows are there (they arrive with the render that ends the fetch).
  useEffect(() => {
    const at = resume.current;
    if (!at || busy) return;
    const controls = [...at.scope.querySelectorAll<HTMLElement>(focusable)].filter((el) => !box.current?.contains(el));
    if (controls.length <= at.before) return;
    resume.current = null;
    const active = document.activeElement;
    if (!active || active === document.body || !document.body.contains(active)) controls[at.before]!.focus();
  });
  if (!query.hasNextPage) return null;
  const load = () => {
    if (busy) return;
    const scope = box.current?.parentElement;
    if (scope) resume.current = { scope, before: [...scope.querySelectorAll(focusable)].filter((el) => !box.current!.contains(el)).length };
    void query.fetchNextPage();
  };
  return (
    <div ref={box} className={s.more}>
      <Button variant="secondary" size="sm" aria-busy={busy || undefined} onClick={load}>
        {busy && <Spinner size="sm" />} Load more
      </Button>
    </div>
  );
}
