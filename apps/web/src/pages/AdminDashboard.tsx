import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

// Health status badge component
function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
        ok
          ? "bg-green-100 text-green-800"
          : "bg-red-100 text-red-800"
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          ok ? "bg-green-500" : "bg-red-500"
        }`}
      />
      {label || (ok ? "Healthy" : "Unhealthy")}
    </span>
  );
}

// Health card component
function HealthCard({
  title,
  ok,
  latencyMs,
  message,
  children,
}: {
  title: string;
  ok: boolean;
  latencyMs?: number;
  message?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <StatusBadge ok={ok} />
      </div>
      {latencyMs !== undefined && (
        <p className="text-sm text-gray-500 mb-2">
          Latency: <span className="font-medium">{latencyMs}ms</span>
        </p>
      )}
      {message && (
        <p className={`text-sm ${ok ? "text-gray-500" : "text-red-600"}`}>
          {message}
        </p>
      )}
      {children}
    </div>
  );
}

// Stats card component
function StatCard({
  label,
  value,
  sublabel,
  subvalue,
}: {
  label: string;
  value: number | string;
  sublabel?: string;
  subvalue?: number | string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
      {sublabel && (
        <p className="text-xs text-gray-400 mt-1">
          {sublabel}: {typeof subvalue === "number" ? subvalue.toLocaleString() : subvalue}
        </p>
      )}
    </div>
  );
}

interface AdminDashboardProps {
  onNavigate: (page: "models" | "settings" | "users") => void;
}

export default function AdminDashboard({ onNavigate }: AdminDashboardProps) {
  const { data: health, isLoading: healthLoading, error: healthError } = useQuery({
    queryKey: ["admin", "dashboard", "health"],
    queryFn: api.getDashboardHealth,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin", "dashboard", "stats"],
    queryFn: api.getDashboardStats,
    refetchInterval: 60000, // Refresh every minute
  });

  const isLoading = healthLoading || statsLoading;

  // Calculate overall health
  const overallHealthy =
    health?.database.ok &&
    (health?.vectorStore.configured ? health?.vectorStore.ok : true) &&
    health?.aiProviders.ok;

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">System Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Monitor system health and usage statistics
          </p>
        </div>

        {/* Overall Status Banner */}
        {!isLoading && health && (
          <div
            className={`mb-8 p-4 rounded-lg border ${
              overallHealthy
                ? "bg-green-50 border-green-200"
                : "bg-red-50 border-red-200"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  overallHealthy ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span
                className={`font-medium ${
                  overallHealthy ? "text-green-800" : "text-red-800"
                }`}
              >
                {overallHealthy
                  ? "All systems operational"
                  : "Some systems require attention"}
              </span>
            </div>
          </div>
        )}

        {/* Health Status Section */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            System Health
          </h2>
          {healthLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse"
                >
                  <div className="h-6 bg-gray-200 rounded w-1/2 mb-4" />
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : healthError ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              Failed to load health status
            </div>
          ) : health ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Database */}
              <HealthCard
                title="Application Database"
                ok={health.database.ok}
                latencyMs={health.database.latencyMs}
                message={health.database.message}
              />

              {/* Vector Store */}
              <HealthCard
                title="Vector Database"
                ok={health.vectorStore.configured ? health.vectorStore.ok : false}
                latencyMs={health.vectorStore.latencyMs}
                message={health.vectorStore.message}
              >
                {health.vectorStore.configured && health.vectorStore.type && (
                  <p className="text-sm text-gray-500 mt-2">
                    Type: <span className="font-medium">{health.vectorStore.type}</span>
                  </p>
                )}
                {health.vectorStore.vectorCount !== undefined && (
                  <p className="text-sm text-gray-500">
                    Vectors: <span className="font-medium">{health.vectorStore.vectorCount.toLocaleString()}</span>
                  </p>
                )}
              </HealthCard>

              {/* AI Providers */}
              <HealthCard
                title="AI Providers"
                ok={health.aiProviders.ok}
                message={health.aiProviders.message}
              >
                <div className="mt-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        health.aiProviders.hasChatModel ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    <span className="text-sm text-gray-600">
                      Chat Model: {health.aiProviders.hasChatModel ? "Configured" : "Not configured"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        health.aiProviders.hasEmbeddingModel ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    <span className="text-sm text-gray-600">
                      Embedding Model: {health.aiProviders.hasEmbeddingModel ? "Configured" : "Not configured"}
                    </span>
                  </div>
                </div>
              </HealthCard>
            </div>
          ) : null}
        </section>

        {/* Usage Stats Section */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Usage Statistics
          </h2>
          {statsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse"
                >
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
                  <div className="h-8 bg-gray-200 rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Users" value={stats.users} />
              <StatCard label="Tenants" value={stats.tenants} />
              <StatCard label="Knowledge Bases" value={stats.knowledgeBases} />
              <StatCard label="Sources" value={stats.sources} />
              <StatCard label="Chunks" value={stats.chunks} />
              <StatCard label="Vectors" value={stats.vectors} />
              <StatCard label="Agents" value={stats.agents} />
              <StatCard
                label="Chat Events (24h)"
                value={stats.chatEvents.last24h}
                sublabel="Last 7 days"
                subvalue={stats.chatEvents.last7d}
              />
            </div>
          ) : null}
        </section>

        {/* Quick Links */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Quick Links
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => onNavigate("models")}
              className="block text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <h3 className="font-medium text-gray-900">AI Models</h3>
              <p className="text-sm text-gray-500 mt-1">
                Configure LLM and embedding providers
              </p>
            </button>
            <button
              onClick={() => onNavigate("settings")}
              className="block text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <h3 className="font-medium text-gray-900">System Settings</h3>
              <p className="text-sm text-gray-500 mt-1">
                Manage authentication and quotas
              </p>
            </button>
            <button
              onClick={() => onNavigate("users")}
              className="block text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <h3 className="font-medium text-gray-900">User Management</h3>
              <p className="text-sm text-gray-500 mt-1">
                Manage users and system admins
              </p>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
