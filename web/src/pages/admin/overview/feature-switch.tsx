/*
 * What the Features switches share (Admin → Settings › Features). Each feature's file keeps its endpoint and its
 * wording; the mechanics are here once:
 *
 * - useFeatureSave: the save of a setting read with its revision. The answer replaces the cached setting (or, where
 *   the cache holds more than the setting, invalidates it), the queries that follow the setting are invalidated, a
 *   toast says the new state, and a failed save (412: it changed elsewhere) reloads the setting.
 * - FeatureSwitch: the switch, which platform admins confirm before turning off (an AlertDialog with what stops);
 *   others see it read-only, with the reason (locked-switch.ts).
 */
import { type QueryKey, type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { lockedSwitch } from "./locked-switch";

type SaveOptions<S, V> = {
  /** The PUT, with If-Match on the loaded revision. */
  put: (next: V) => Promise<S>;
  /** The setting's query: it gets the answer, and is reloaded when the save fails. */
  queryKey: QueryKey;
  /** "invalidate" where the query holds more than the PUT answers; by default the answer is stored as the query's data. */
  store?: "set" | "invalidate";
  /** Queries that follow the setting (the capabilities in ["me"], a team's pages). */
  alsoInvalidate?: QueryKey[];
  /** The toast: "Webhooks are on". */
  saved: (settings: S) => string;
};

export function useFeatureSave<S, V = boolean>({ put, queryKey, store = "set", alsoInvalidate = [], saved }: SaveOptions<S, V>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: put,
    onSuccess: (st) => {
      if (store === "set") qc.setQueryData(queryKey, st);
      else void qc.invalidateQueries({ queryKey });
      for (const key of alsoInvalidate) void qc.invalidateQueries({ queryKey: key });
      toast.success(saved(st));
    },
    onError: () => void qc.invalidateQueries({ queryKey }),
  });
}

type SwitchProps<V> = {
  /** The switch's name: "Allow webhooks". */
  label: string;
  /** The setting; undefined until it has loaded (nothing is shown). */
  enabled: boolean | undefined;
  save: Pick<UseMutationResult<unknown, Error, V>, "mutate" | "isPending" | "error">;
  /** What to save for on and off, where the PUT takes more than the flag. */
  value?: (enabled: boolean) => V;
  isAdmin: boolean;
  /** Also disabled while this is true (another save of the same setting). */
  busy?: boolean;
  /** The confirmation before turning it off. */
  off: { title: string; description: string; confirmLabel: string };
  /** Controls beside the switch. */
  children?: ReactNode;
};

export function FeatureSwitch<V = boolean>({ label, enabled, save, value = (v) => v as V, isAdmin, busy = false, off, children }: SwitchProps<V>) {
  const [confirming, setConfirming] = useState(false);
  if (enabled === undefined) return null;
  return (
    <>
      <Switch
        label={label}
        labelPosition="start"
        checked={enabled}
        disabled={save.isPending || busy}
        {...lockedSwitch(isAdmin)}
        onCheckedChange={(v) => (v ? save.mutate(value(true)) : setConfirming(true))}
      />
      {children}
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title={off.title}
        description={off.description}
        confirmLabel={off.confirmLabel}
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(value(false), { onSuccess: () => setConfirming(false) })}
      />
    </>
  );
}
