/* Cancel and delete a report (docs/content-health.md). Both work while the platform switch is off: a team can always stop and remove what is kept. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { healthKey, reportKey } from "./queries";

export function useReportActions(team: string, reportId: string, onDeleted?: () => void) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: healthKey(team) });
    void qc.invalidateQueries({ queryKey: reportKey(team, reportId) });
  };
  const cancel = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/teams/{team}/content-health/reports/{reportId}/cancel", { params: { path: { team, reportId } } })),
    onSuccess: refresh,
  });
  const del = useMutation({
    mutationFn: async () => {
      const r = await api.DELETE("/v1/teams/{team}/content-health/reports/{reportId}", { params: { path: { team, reportId } } });
      if (r.error) throw r.error;
    },
    onSuccess: () => {
      onDeleted?.();
      void qc.invalidateQueries({ queryKey: healthKey(team) });
    },
  });
  return { cancel, del };
}
