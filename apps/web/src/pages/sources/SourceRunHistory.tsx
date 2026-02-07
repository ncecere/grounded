import type { SourceRun } from "@/lib/api/types/sources";
import { getDisplayStatus, getStatusColor } from "./source-utils";

interface SourceRunHistoryProps {
  runs: SourceRun[] | undefined;
  hasSelectedSource: boolean;
}

export function SourceRunHistory({ runs, hasSelectedSource }: SourceRunHistoryProps) {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="font-medium text-foreground mb-4">Run History</h3>
      {hasSelectedSource ? (
        runs && runs.length > 0 ? (
          <div className="space-y-3">
            {runs.map((run) => {
              const displayStatus = getDisplayStatus(run);
              const isEmbedding = displayStatus === "embedding";
              const embeddingPercent = run.chunksToEmbed > 0
                ? Math.round((run.chunksEmbedded / run.chunksToEmbed) * 100)
                : 0;

              return (
                <div key={run.id} className="p-3 bg-muted rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(displayStatus)}`}>
                      {displayStatus}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {run.startedAt ? new Date(run.startedAt).toLocaleString() : "Pending"}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    <p>Pages seen: {run.stats?.pagesSeen ?? 0}</p>
                    <p>Pages indexed: {run.stats?.pagesIndexed ?? 0}</p>
                    {(run.stats?.pagesFailed ?? 0) > 0 && (
                      <p className="text-destructive">Failed: {run.stats.pagesFailed}</p>
                    )}
                  </div>
                  {(isEmbedding || (run.chunksToEmbed > 0 && run.chunksEmbedded > 0)) && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span className="flex items-center gap-1">
                          {isEmbedding && (
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                          )}
                          Embeddings
                        </span>
                        <span>{run.chunksEmbedded} / {run.chunksToEmbed} chunks ({embeddingPercent}%)</span>
                      </div>
                      <div className="w-full bg-muted-foreground/20 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-300 ${isEmbedding ? "bg-purple-500" : "bg-green-500"}`}
                          style={{ width: `${embeddingPercent}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                  {run.error && (
                    <p className="mt-2 text-xs text-destructive">{run.error}</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No runs yet</p>
        )
      ) : (
        <p className="text-sm text-muted-foreground">Select a source to view run history</p>
      )}
    </div>
  );
}
