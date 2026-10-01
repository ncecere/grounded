/*
 * Agent → Settings › Saved answers (the answer cache, docs/answer-cache.md):
 * whether the agent reuses a recent answer to the same question, whether a
 * near-identical question counts (confirmed by SystemOne), how long an
 * answer is reused, and Clear saved answers. The settings aren't versioned:
 * each change saves at once (If-Match) and applies to the next question.
 * People chatting never see whether an answer was saved.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { SettingsSection } from "@/components/templates/settings-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Select } from "@/components/ui/select/select";
import { Skeleton } from "@/components/ui/skeleton/skeleton";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { agentKey } from "../team/common";
import a from "./agents.module.css";

type Cache = Schemas["AgentAnswerCache"];
type Update = Schemas["AgentAnswerCacheUpdate"];

/** The time limits offered, in hours. */
export const expiryChoices = [1, 6, 12, 24, 48, 72, 168, 336, 720];

/** "1 hour", "24 hours", "3 days", "30 days". */
export function expiryLabel(h: number) {
  if (h >= 48 && h % 24 === 0) return `${h / 24} days`;
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}

/** What the agent does now, in one sentence. */
export function cacheSummary(c: Cache) {
  if (!c.platformEnabled) return "A platform admin turned saved answers off for every agent, so each question is answered afresh.";
  if (!c.on) return "Each question is answered afresh.";
  const saved = c.entries === 1 ? "1 saved answer" : `${c.entries.toLocaleString()} saved answers`;
  const reused = c.hits === 1 ? "reused once" : `reused ${c.hits.toLocaleString()} times`;
  return `${saved}, ${reused}.`;
}

function useAnswerCache(team: string, agentId: string) {
  const qc = useQueryClient();
  const key = [...agentKey(team, agentId), "answer-cache"];
  const path = { team, agentId };
  const query = useQuery({ queryKey: key, queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}/answer-cache", { params: { path } })) });
  const save = useMutation({
    mutationFn: async (body: Update) =>
      unwrap(await api.PUT("/v1/teams/{team}/agents/{agentId}/answer-cache", { params: { path, header: ifMatch(query.data!.revision) }, body })),
    onSuccess: (c) => qc.setQueryData(key, c),
    onError: () => void qc.invalidateQueries({ queryKey: key }),
  });
  const clear = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/teams/{team}/agents/{agentId}/answer-cache/clear", { params: { path } })),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: key });
      toast.success(r.cleared === 1 ? "Cleared 1 saved answer" : `Cleared ${r.cleared.toLocaleString()} saved answers`);
    },
  });
  return { query, save, clear };
}

export function AnswerCacheSection({ team, agentId }: { team: string; agentId: string }) {
  const { query, save, clear } = useAnswerCache(team, agentId);
  const [confirming, setConfirming] = useState(false);
  const c = query.data;
  const body = (patch: Partial<Update>): Update => ({ enabled: c!.enabled ?? null, nearIdentical: c!.nearIdentical, expiryHours: c!.expiryHours, ...patch });
  const audienceDefault = c?.audience === "public" ? "On by default for public agents." : "Off by default for agents that aren't public.";
  return (
    <SettingsSection
      id="saved-answers"
      title="Saved answers"
      description="Reuse a recent answer when someone asks the same question again: it arrives at once and costs no model tokens. People can't tell the difference."
    >
      {query.error ? (
        <ErrorAlert error={query.error} title="Couldn't load saved answers" />
      ) : !c ? (
        <Skeleton height="6rem" />
      ) : (
        <>
          {!c.platformEnabled && (
            <Alert tone="info" title="Turned off for every agent">
              A platform admin turned saved answers off. These settings apply again once it's turned back on.
            </Alert>
          )}
          {save.error != null && <ErrorAlert error={save.error} title="Couldn't save" />}
          <Switch
            label="Reuse answers"
            description={`${audienceDefault} Answers that used a tool, failed or were refused are never saved.`}
            checked={c.on}
            disabled={save.isPending}
            onCheckedChange={(v) => save.mutate(body({ enabled: v }))}
          />
          <Switch
            label="Also reuse answers to near-identical questions"
            description={
              c.nearIdenticalAvailable
                ? "SystemOne confirms the questions ask the same thing, so “hours on Saturday” never gets the answer about Sunday."
                : "Needs a SystemOne model, which a platform admin sets up."
            }
            checked={c.nearIdentical}
            disabled={save.isPending || !c.on || (!c.nearIdenticalAvailable && !c.nearIdentical)}
            onCheckedChange={(v) => save.mutate(body({ nearIdentical: v }))}
          />
          <Select<string>
            label="Reuse an answer for"
            items={expiryChoices.concat(expiryChoices.includes(c.expiryHours) ? [] : [c.expiryHours]).map((h) => ({ value: String(h), label: expiryLabel(h) }))}
            value={String(c.expiryHours)}
            disabled={save.isPending || !c.on}
            onValueChange={(v) => v && Number(v) !== c.expiryHours && save.mutate(body({ expiryHours: Number(v) }))}
            className={a.cacheExpiry}
          />
          <div className={a.cacheFooter}>
            <p className={a.cacheSummary}>{cacheSummary(c)} A change to the agent or its knowledge starts afresh.</p>
            <Button variant="secondary" disabled={c.entries === 0 || clear.isPending} onClick={() => setConfirming(true)}>
              Clear saved answers
            </Button>
          </div>
          <AlertDialog
            open={confirming}
            onOpenChange={(o) => !o && setConfirming(false)}
            title="Clear this agent's saved answers?"
            description="The next questions are answered afresh, and their answers are saved again."
            confirmLabel="Clear saved answers"
            busy={clear.isPending}
            error={clear.error}
            onConfirm={() => clear.mutate(undefined, { onSuccess: () => setConfirming(false) })}
          />
        </>
      )}
    </SettingsSection>
  );
}
