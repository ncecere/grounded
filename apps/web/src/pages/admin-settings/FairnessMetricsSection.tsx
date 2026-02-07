import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/form-section";
import { RefreshCw, AlertTriangle } from "lucide-react";

export function FairnessMetricsSection() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["fairness-metrics"],
    queryFn: () => api.getFairnessMetrics(),
    refetchInterval: 5000,
  });

  const resetMutation = useMutation({
    mutationFn: () => api.resetFairnessState(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fairness-metrics"] });
    },
  });

  const metrics = data?.metrics;

  return (
    <FormSection
      title="Fairness Scheduler Status"
      description="Real-time status of the scraper fairness scheduler. Shows how worker capacity is distributed across concurrent source runs."
      className="mt-6"
    >
      {isLoading ? (
        <div className="py-4 text-sm text-muted-foreground">Loading metrics...</div>
      ) : error || !data?.success ? (
        <div className="py-4 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4" />
          {data?.error || "Failed to load fairness metrics"}
        </div>
      ) : metrics ? (
        <div className="py-4 space-y-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-muted rounded-lg">
              <div className="text-xs text-muted-foreground">Active Runs</div>
              <div className="text-2xl font-semibold">{metrics.activeRunCount}</div>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <div className="text-xs text-muted-foreground">Slots In Use</div>
              <div className="text-2xl font-semibold">
                {metrics.totalSlotsInUse} / {metrics.totalSlotsAvailable}
              </div>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <div className="text-xs text-muted-foreground">Fair Share/Run</div>
              <div className="text-2xl font-semibold">{metrics.fairSharePerRun}</div>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <div className="text-xs text-muted-foreground">Last Updated</div>
              <div className="text-sm font-medium">
                {new Date(metrics.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>

          {/* Per-Run Slot Allocation */}
          {Object.keys(metrics.runSlots).length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium mb-2">Active Run Slot Allocation</h4>
              <div className="space-y-2">
                {Object.entries(metrics.runSlots).map(([runId, slots]) => (
                  <div key={runId} className="flex items-center gap-2 text-sm">
                    <code className="text-xs bg-muted px-2 py-0.5 rounded">
                      {runId.substring(0, 8)}...
                    </code>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{
                          width: `${Math.min(100, (slots / metrics.totalSlotsAvailable) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-12 text-right">
                      {slots} slots
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reset Button */}
          <div className="pt-4 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${resetMutation.isPending ? "animate-spin" : ""}`} />
              Reset Fairness State
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              Emergency reset - clears all active run registrations and slot counts.
            </p>
          </div>
        </div>
      ) : (
        <div className="py-4 text-sm text-muted-foreground">
          No active runs. Fairness metrics will appear when source runs are processing.
        </div>
      )}
    </FormSection>
  );
}
