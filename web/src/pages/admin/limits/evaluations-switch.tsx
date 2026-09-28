/*
 * Admin → Limits › Evaluations: the platform switch for evaluation sets
 * (docs/evaluations.md §5), next to the evaluation limits. On by default;
 * while off, the Evaluations tabs are hidden and the evaluation API answers
 * 404. Sets and runs are kept. Changes are audited.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ifMatch, unwrap } from "@/api/client";
import { QueryView } from "@/components/query-view";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";

const settingsKey = ["admin", "evaluations"];

export function EvaluationsSwitch({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: settingsKey, queryFn: async () => unwrap(await api.GET("/v1/admin/settings/evaluations")) });
  const save = useMutation({
    mutationFn: async (enabled: boolean) =>
      unwrap(await api.PUT("/v1/admin/settings/evaluations", { params: { header: ifMatch(settings.data!.revision) }, body: { enabled } })),
    onSuccess: (st) => {
      qc.setQueryData(settingsKey, st);
      void qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(st.enabled ? "Evaluations are on" : "Evaluations are off");
    },
    onError: () => void qc.invalidateQueries({ queryKey: settingsKey }),
  });
  return (
    <Card
      title="Evaluation sets"
      description="Team editors, admins and owners build sets of test questions for their knowledge bases and agents, and run them to catch regressions. Members never see them. Changes are audited."
    >
      <QueryView query={settings} loadingLabel="Loading the setting…">
        {settings.data && (
          <Stack gap={3}>
            <Switch
              label="Allow evaluations"
              description={settings.data.enabled ? "Knowledge bases and agents show an Evaluations tab to editors." : "The Evaluations tabs are hidden and the evaluation API is closed."}
              checked={settings.data.enabled}
              disabled={!isAdmin || save.isPending}
              onCheckedChange={(v) => save.mutate(v)}
            />
            {!settings.data.enabled && <Alert tone="info">Existing sets and runs are kept and come back when you turn this on. Automatic runs don't start meanwhile.</Alert>}
            <ErrorAlert error={save.error} />
          </Stack>
        )}
      </QueryView>
    </Card>
  );
}
