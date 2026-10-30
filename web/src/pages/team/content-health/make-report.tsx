/*
 * Make a report (docs/content-health.md): the scope (all of the team's sources, one source, or one knowledge base) and the two
 * thresholds. It only queues the report; a background job makes it. Refused while a report is being made, and for a few minutes
 * after the last one began (the server says when to try again).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { toast } from "@/components/ui/toast/toast";
import { useTeam } from "../common";
import { type ReportList, healthKey } from "./queries";

type Limits = ReportList["limits"];

const sourcesQuery = (team: string) => ({
  queryKey: ["team", team, "sources"],
  queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/sources", { params: { path: { team } } })),
});
const kbsQuery = (team: string) => ({
  queryKey: ["team", team, "kbs"],
  queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/kbs", { params: { path: { team } } })),
});

export function MakeReport({ team, limits, active, onMade }: { team: string; limits: Limits; active: boolean; onMade: (id: string) => void }) {
  const { archived } = useTeam();
  const qc = useQueryClient();
  const sources = useQuery(sourcesQuery(team));
  const kbs = useQuery(kbsQuery(team));
  const [scope, setScope] = useState("all");
  const [staleText, setStale] = useState(String(limits.defaultStaleDays));
  const [windowText, setWindow] = useState(String(limits.defaultCitationWindowDays));
  const stale = Number(staleText);
  const window = Number(windowText);
  const staleOk = staleText !== "" && Number.isInteger(stale) && stale >= limits.minStaleDays && stale <= limits.maxStaleDays;
  const windowOk = windowText !== "" && Number.isInteger(window) && window >= limits.minCitationWindowDays && window <= limits.maxCitationWindowDays;
  const make = useMutation({
    mutationFn: async () => {
      const [kind, id] = scope.split(":");
      return unwrap(
        await api.POST("/v1/teams/{team}/content-health/reports", {
          params: { path: { team } },
          body: { staleDays: stale, citationWindowDays: window, ...(kind === "source" ? { sourceId: id } : {}), ...(kind === "kb" ? { knowledgeBaseId: id } : {}) },
        }),
      );
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: healthKey(team) });
      onMade(r.id);
      toast.success("The report is being made");
    },
  });
  return (
    <Card title="Make a report" titleAs="h2" description="Choose what to look at. The report is made in the background; this page updates by itself.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (staleOk && windowOk) make.mutate();
        }}
      >
        <ApiErrorAlert error={make.error} title="Couldn't make the report" />
        <Field label="What to look at" description="Only this team's own sources. Shared platform sources are never included.">
          <NativeSelect value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">All of the team's sources</option>
            {(sources.data ?? []).length > 0 && (
              <optgroup label="One source">
                {sources.data?.map((s) => (
                  <option key={s.id} value={`source:${s.id}`}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
            {(kbs.data ?? []).length > 0 && (
              <optgroup label="One knowledge base's sources">
                {kbs.data?.map((k) => (
                  <option key={k.id} value={`kb:${k.id}`}>
                    {k.name}
                  </option>
                ))}
              </optgroup>
            )}
          </NativeSelect>
        </Field>
        <Field
          label="Not processed for (days)"
          description={`A document whose last successful processing was at least this long ago is listed. ${limits.minStaleDays} to ${limits.maxStaleDays}.`}
          error={staleOk ? undefined : `Enter a whole number from ${limits.minStaleDays} to ${limits.maxStaleDays}.`}
        >
          <NumberInput maximumFractionDigits={0} value={staleText} onValueChange={setStale} />
        </Field>
        <Field
          label="Look for citations over (days)"
          description={`How far back to read kept answers when looking for documents with no citation evidence (team-wide). ${limits.minCitationWindowDays} to ${limits.maxCitationWindowDays}. It never reaches back before the team's oldest kept answer. A narrower scope does not read fewer answers; only a shorter window does.`}
          error={windowOk ? undefined : `Enter a whole number from ${limits.minCitationWindowDays} to ${limits.maxCitationWindowDays}.`}
        >
          <NumberInput maximumFractionDigits={0} value={windowText} onValueChange={setWindow} />
        </Field>
        <Button type="submit" loading={make.isPending} disabled={archived || active || !staleOk || !windowOk}>
          Make report
        </Button>
        {archived && <p>This team is archived, so no new report can be made.</p>}
        {active && <p>A report is being made. You can make another when it ends.</p>}
      </form>
    </Card>
  );
}
