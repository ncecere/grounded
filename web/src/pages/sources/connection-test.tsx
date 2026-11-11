/* "Test connection": tries a connector's settings and credentials without saving them, and says what they reach. */
import { useMutation } from "@tanstack/react-query";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import type { ConnectionCheck } from "./owner";
import w from "./connection-test.module.css";

type Props = {
  /** Runs the check with the form's current values. */
  run: () => Promise<ConnectionCheck>;
  /** Why the check can't run yet (a required field is empty), if it can't. */
  blocked?: string;
};

export function ConnectionTest({ run, blocked }: Props) {
  const check = useMutation({ mutationFn: run });
  const kinds = [...new Set((check.data?.reachable ?? []).map((r) => r.kind))];
  return (
    <div className={w.test}>
      <div className={w.row}>
        <Button variant="secondary" loading={check.isPending} disabled={!!blocked} onClick={() => check.mutate()}>
          Test connection
        </Button>
        <span className={w.hint}>{blocked ?? "Nothing is saved by a test."}</span>
      </div>
      {check.error ? <ErrorAlert error={check.error} title="The connection didn't work" /> : null}
      {check.data && (
        <Alert tone="success" title="The connection works">
          {check.data.summary}
          {kinds.map((kind) => {
            const items = check.data.reachable.filter((r) => r.kind === kind);
            return (
              <div key={kind} className={w.reach}>
                <span className={w.kind}>
                  {items.length.toLocaleString()} {kind}
                  {items.length === 1 ? "" : "s"} it can read:
                </span>
                <ul>
                  {items.slice(0, 20).map((r) => (
                    <li key={r.id}>
                      {r.name} <code>{r.id}</code>
                    </li>
                  ))}
                </ul>
                {items.length > 20 && <span className={w.hint}>and {(items.length - 20).toLocaleString()} more.</span>}
              </div>
            );
          })}
        </Alert>
      )}
    </div>
  );
}
