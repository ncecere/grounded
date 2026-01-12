import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  type AdminAnalyticsOverview,
  type AdminAnalyticsTenants,
  type AdminAnalyticsTenantDetail,
  type TenantHealthFlag,
} from "../lib/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import {
  ArrowLeft,
  Download,
  AlertTriangle,
  CheckCircle,
  Building2,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Clock,
  Zap,
  Database,
  Users,
  Bot,
  MessageSquare,
  Activity,
  FileText,
  Globe,
} from "lucide-react";

type Tab = "overview" | "tenants";

interface Props {
  onNavigateToTenant?: (tenantId: string) => void;
}

export function AdminAnalytics({ onNavigateToTenant }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
  });

  const handleExportOverview = async () => {
    const response = await api.exportAdminAnalyticsOverview(dateRange);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-overview-${dateRange.startDate}-${dateRange.endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleExportTenants = async () => {
    const response = await api.exportAdminAnalyticsTenants();
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tenants-analytics.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (selectedTenantId) {
    return (
      <TenantDetailView
        tenantId={selectedTenantId}
        dateRange={dateRange}
        onBack={() => setSelectedTenantId(null)}
      />
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            System-wide usage metrics and tenant health monitoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={dateRange.startDate}
            onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
          <span className="text-gray-500">to</span>
          <input
            type="date"
            value={dateRange.endDate}
            onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab("overview")}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === "overview"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Overview
            </div>
          </button>
          <button
            onClick={() => setActiveTab("tenants")}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === "tenants"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Tenants
            </div>
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <OverviewTab
          dateRange={dateRange}
          onExport={handleExportOverview}
        />
      )}
      {activeTab === "tenants" && (
        <TenantsTab
          dateRange={dateRange}
          onSelectTenant={(id) => setSelectedTenantId(id)}
          onExport={handleExportTenants}
        />
      )}
    </div>
  );
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab({
  dateRange,
  onExport,
}: {
  dateRange: { startDate: string; endDate: string };
  onExport: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-analytics-overview", dateRange],
    queryFn: () => api.getAdminAnalyticsOverview(dateRange),
  });

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Failed to load analytics data</p>
      </div>
    );
  }

  const { overview, queriesByDay, queriesByChannel, topTenants } = data;

  return (
    <div className="space-y-6">
      {/* Export Button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<MessageSquare className="w-6 h-6 text-blue-600" />}
          iconBg="bg-blue-100"
          label="Total Queries"
          value={overview.totalQueries.toLocaleString()}
        />
        <StatCard
          icon={<CheckCircle className="w-6 h-6 text-green-600" />}
          iconBg="bg-green-100"
          label="Successful"
          value={overview.successfulQueries.toLocaleString()}
          sublabel={`${overview.errorRate.toFixed(1)}% error rate`}
          sublabelColor={overview.errorRate > 5 ? "text-red-500" : "text-gray-500"}
        />
        <StatCard
          icon={<Clock className="w-6 h-6 text-purple-600" />}
          iconBg="bg-purple-100"
          label="Avg Latency"
          value={`${(overview.avgLatencyMs / 1000).toFixed(2)}s`}
        />
        <StatCard
          icon={<Zap className="w-6 h-6 text-orange-600" />}
          iconBg="bg-orange-100"
          label="Total Tokens"
          value={formatNumber(overview.totalTokens)}
          sublabel={`${formatNumber(overview.promptTokens)} / ${formatNumber(overview.completionTokens)}`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          icon={<Building2 className="w-6 h-6 text-indigo-600" />}
          iconBg="bg-indigo-100"
          label="Active Tenants"
          value={overview.activeTenants.toString()}
        />
        <StatCard
          icon={<Bot className="w-6 h-6 text-teal-600" />}
          iconBg="bg-teal-100"
          label="Active Agents"
          value={overview.activeAgents.toString()}
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Queries Over Time */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Queries Over Time</h3>
          {queriesByDay && queriesByDay.length > 0 ? (
            <QueryChart data={queriesByDay} />
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-500">
              No data available for this period
            </div>
          )}
        </div>

        {/* Queries by Channel */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Queries by Channel</h3>
          {queriesByChannel && queriesByChannel.length > 0 ? (
            <div className="space-y-4">
              {queriesByChannel.map((channel) => {
                const total = queriesByChannel.reduce((sum, c) => sum + c.count, 0);
                const percent = total > 0 ? (channel.count / total) * 100 : 0;
                return (
                  <div key={channel.channel} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium capitalize">{channel.channel.replace("_", " ")}</span>
                      <span className="text-gray-500">{channel.count.toLocaleString()} ({percent.toFixed(1)}%)</span>
                    </div>
                    <Progress value={percent} className="h-2" />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-500">
              No data available
            </div>
          )}
        </div>
      </div>

      {/* Top Tenants */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Tenants by Queries</h3>
        {topTenants && topTenants.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b">
                  <th className="pb-3 font-medium">Tenant</th>
                  <th className="pb-3 font-medium text-right">Queries</th>
                  <th className="pb-3 font-medium text-right">Errors</th>
                  <th className="pb-3 font-medium text-right">Error Rate</th>
                </tr>
              </thead>
              <tbody>
                {topTenants.map((tenant) => (
                  <tr key={tenant.tenantId} className="border-b last:border-0">
                    <td className="py-3 font-medium">{tenant.tenantName}</td>
                    <td className="py-3 text-right">{tenant.queries.toLocaleString()}</td>
                    <td className="py-3 text-right">{tenant.errors.toLocaleString()}</td>
                    <td className="py-3 text-right">
                      <span className={tenant.errorRate > 10 ? "text-red-600 font-medium" : ""}>
                        {tenant.errorRate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            No tenant data available
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Tenants Tab
// ============================================================================

function TenantsTab({
  dateRange,
  onSelectTenant,
  onExport,
}: {
  dateRange: { startDate: string; endDate: string };
  onSelectTenant: (id: string) => void;
  onExport: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-analytics-tenants", dateRange],
    queryFn: () => api.getAdminAnalyticsTenants(dateRange),
  });

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Failed to load tenant data</p>
      </div>
    );
  }

  const { tenants, summary } = data;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Tenants</p>
              <p className="text-2xl font-bold text-gray-900">{summary.total}</p>
            </div>
            <Building2 className="w-8 h-8 text-gray-400" />
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Healthy</p>
              <p className="text-2xl font-bold text-green-600">{summary.healthy}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">With Warnings</p>
              <p className="text-2xl font-bold text-yellow-600">{summary.withWarnings}</p>
            </div>
            <AlertTriangle className="w-8 h-8 text-yellow-500" />
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 flex items-center justify-center">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Flag Summary */}
      {summary.withWarnings > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="font-medium text-yellow-800 mb-2">Warning Flags Summary</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.flagCounts).map(([flag, count]) => {
              if (count === 0) return null;
              return (
                <Badge key={flag} variant="outline" className="bg-yellow-100 border-yellow-300">
                  {getFlagLabel(flag as TenantHealthFlag)}: {count}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Tenants Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-b bg-gray-50">
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium text-center">Health</th>
                <th className="px-4 py-3 font-medium text-right">Queries</th>
                <th className="px-4 py-3 font-medium text-right">Error Rate</th>
                <th className="px-4 py-3 font-medium text-right">KBs</th>
                <th className="px-4 py-3 font-medium text-right">Agents</th>
                <th className="px-4 py-3 font-medium">Flags</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr
                  key={tenant.id}
                  className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                  onClick={() => onSelectTenant(tenant.id)}
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{tenant.name}</p>
                      <p className="text-sm text-gray-500">{tenant.slug}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <HealthScoreBadge score={tenant.healthScore} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {tenant.usage.totalQueries.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={tenant.usage.errorRate > 10 ? "text-red-600 font-medium" : ""}>
                      {tenant.usage.errorRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={tenant.resources.kbs >= tenant.resources.maxKbs * 0.8 ? "text-yellow-600" : ""}>
                      {tenant.resources.kbs}/{tenant.resources.maxKbs}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={tenant.resources.agents >= tenant.resources.maxAgents * 0.8 ? "text-yellow-600" : ""}>
                      {tenant.resources.agents}/{tenant.resources.maxAgents}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {tenant.flags.map((flag) => (
                        <FlagBadge key={flag} flag={flag} />
                      ))}
                      {tenant.flags.length === 0 && (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm">
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Tenant Detail View
// ============================================================================

function TenantDetailView({
  tenantId,
  dateRange,
  onBack,
}: {
  tenantId: string;
  dateRange: { startDate: string; endDate: string };
  onBack: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-analytics-tenant", tenantId, dateRange],
    queryFn: () => api.getAdminAnalyticsTenantDetail(tenantId, dateRange),
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tenants
        </button>
        <p className="text-red-600">Failed to load tenant data</p>
      </div>
    );
  }

  const { tenant, resources, quotas, currentUsage, stats, queriesByDay, queriesByChannel, byAgent, historicalUsage } = data;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Tenants
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
          <p className="text-sm text-gray-500">{tenant.slug}</p>
        </div>
        <div className="text-right text-sm text-gray-500">
          Created: {new Date(tenant.createdAt).toLocaleDateString()}
        </div>
      </div>

      {/* Resource Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <StatCard
          icon={<Users className="w-5 h-5 text-blue-600" />}
          iconBg="bg-blue-100"
          label="Members"
          value={resources.members.toString()}
          small
        />
        <StatCard
          icon={<Database className="w-5 h-5 text-purple-600" />}
          iconBg="bg-purple-100"
          label="Knowledge Bases"
          value={`${resources.kbs}/${quotas.maxKbs}`}
          small
        />
        <StatCard
          icon={<Bot className="w-5 h-5 text-green-600" />}
          iconBg="bg-green-100"
          label="Agents"
          value={`${resources.agents}/${quotas.maxAgents}`}
          small
        />
        <StatCard
          icon={<Globe className="w-5 h-5 text-teal-600" />}
          iconBg="bg-teal-100"
          label="Sources"
          value={resources.sources.toString()}
          small
        />
        <StatCard
          icon={<FileText className="w-5 h-5 text-orange-600" />}
          iconBg="bg-orange-100"
          label="Chunks"
          value={formatNumber(resources.chunks)}
          small
        />
      </div>

      {/* Query Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          icon={<MessageSquare className="w-6 h-6 text-blue-600" />}
          iconBg="bg-blue-100"
          label="Total Queries"
          value={stats.totalQueries.toLocaleString()}
        />
        <StatCard
          icon={<CheckCircle className="w-6 h-6 text-green-600" />}
          iconBg="bg-green-100"
          label="Success Rate"
          value={`${(100 - stats.errorRate).toFixed(1)}%`}
          sublabel={`${stats.errorQueries} errors`}
          sublabelColor={stats.errorRate > 5 ? "text-red-500" : "text-gray-500"}
        />
        <StatCard
          icon={<Clock className="w-6 h-6 text-purple-600" />}
          iconBg="bg-purple-100"
          label="Latency (p50/p95)"
          value={`${(stats.p50LatencyMs / 1000).toFixed(2)}s`}
          sublabel={`p95: ${(stats.p95LatencyMs / 1000).toFixed(2)}s`}
        />
        <StatCard
          icon={<Zap className="w-6 h-6 text-orange-600" />}
          iconBg="bg-orange-100"
          label="Tokens Used"
          value={formatNumber(stats.totalTokens)}
        />
      </div>

      {/* Usage Quotas */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Monthly Quota Usage ({currentUsage.month})</h3>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Uploaded Documents</span>
              <span>{currentUsage.uploadedDocs} / {quotas.maxUploadedDocsPerMonth}</span>
            </div>
            <Progress
              value={(currentUsage.uploadedDocs / quotas.maxUploadedDocsPerMonth) * 100}
              className="h-2"
            />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Scraped Pages</span>
              <span>{currentUsage.scrapedPages} / {quotas.maxScrapedPagesPerMonth}</span>
            </div>
            <Progress
              value={(currentUsage.scrapedPages / quotas.maxScrapedPagesPerMonth) * 100}
              className="h-2"
            />
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Queries Over Time */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Queries Over Time</h3>
          {queriesByDay && queriesByDay.length > 0 ? (
            <QueryChart data={queriesByDay} />
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-500">
              No data available
            </div>
          )}
        </div>

        {/* Channel Breakdown */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Queries by Channel</h3>
          {queriesByChannel && queriesByChannel.length > 0 ? (
            <div className="space-y-4">
              {queriesByChannel.map((channel) => {
                const total = queriesByChannel.reduce((sum, c) => sum + c.count, 0);
                const percent = total > 0 ? (channel.count / total) * 100 : 0;
                return (
                  <div key={channel.channel} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium capitalize">{channel.channel.replace("_", " ")}</span>
                      <span className="text-gray-500">
                        {channel.count.toLocaleString()} ({percent.toFixed(1)}%)
                        {channel.errors > 0 && (
                          <span className="text-red-500 ml-2">
                            {channel.errors} errors
                          </span>
                        )}
                      </span>
                    </div>
                    <Progress value={percent} className="h-2" />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-500">
              No data available
            </div>
          )}
        </div>
      </div>

      {/* Agents Table */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Agent Performance</h3>
        {byAgent && byAgent.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b">
                  <th className="pb-3 font-medium">Agent</th>
                  <th className="pb-3 font-medium text-right">Queries</th>
                  <th className="pb-3 font-medium text-right">Errors</th>
                  <th className="pb-3 font-medium text-right">Error Rate</th>
                  <th className="pb-3 font-medium text-right">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {byAgent.map((agent) => (
                  <tr key={agent.agentId} className="border-b last:border-0">
                    <td className="py-3 font-medium">{agent.agentName}</td>
                    <td className="py-3 text-right">{agent.queries.toLocaleString()}</td>
                    <td className="py-3 text-right">{agent.errors}</td>
                    <td className="py-3 text-right">
                      <span className={agent.errorRate > 10 ? "text-red-600 font-medium" : ""}>
                        {agent.errorRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 text-right">{(agent.avgLatency / 1000).toFixed(2)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            No agent data available
          </div>
        )}
      </div>

      {/* Historical Usage */}
      {historicalUsage && historicalUsage.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Historical Usage</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b">
                  <th className="pb-3 font-medium">Month</th>
                  <th className="pb-3 font-medium text-right">Uploads</th>
                  <th className="pb-3 font-medium text-right">Scraped</th>
                  <th className="pb-3 font-medium text-right">Chat Requests</th>
                  <th className="pb-3 font-medium text-right">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {historicalUsage.map((usage) => (
                  <tr key={usage.month} className="border-b last:border-0">
                    <td className="py-3 font-medium">{usage.month}</td>
                    <td className="py-3 text-right">{usage.uploadedDocs.toLocaleString()}</td>
                    <td className="py-3 text-right">{usage.scrapedPages.toLocaleString()}</td>
                    <td className="py-3 text-right">{usage.chatRequests.toLocaleString()}</td>
                    <td className="py-3 text-right">
                      {formatNumber(usage.promptTokens + usage.completionTokens)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Shared Components
// ============================================================================

function StatCard({
  icon,
  iconBg,
  label,
  value,
  sublabel,
  sublabelColor = "text-gray-500",
  small = false,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  sublabel?: string;
  sublabelColor?: string;
  small?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center gap-3">
        <div className={`p-2 ${iconBg} rounded-lg`}>
          {icon}
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className={`${small ? "text-xl" : "text-2xl"} font-bold text-gray-900`}>{value}</p>
          {sublabel && (
            <p className={`text-xs ${sublabelColor}`}>{sublabel}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function QueryChart({ data }: { data: Array<{ date: string; count: number; errors?: number }> }) {
  const maxCount = Math.max(...data.map((d) => d.count));
  const yMax = Math.max(maxCount, 1);
  const yLabels = [yMax, Math.round(yMax * 0.75), Math.round(yMax * 0.5), Math.round(yMax * 0.25), 0];

  return (
    <div className="h-48">
      <div className="flex h-40">
        <div className="flex flex-col justify-between text-xs text-gray-500 pr-2 py-1 w-10">
          {yLabels.map((val, i) => (
            <span key={i} className="text-right">{formatNumber(val)}</span>
          ))}
        </div>
        <div className="flex-1 border-l border-b border-gray-200 relative">
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {yLabels.map((_, i) => (
              <div key={i} className="border-t border-gray-100 w-full" />
            ))}
          </div>
          <div className="absolute inset-0 flex items-end justify-around px-1 pb-1">
            {data.slice(-14).map((day, i) => {
              const heightPercent = yMax > 0 ? (day.count / yMax) * 100 : 0;
              return (
                <div
                  key={i}
                  className="flex-1 flex justify-center max-w-[40px] h-full items-end"
                >
                  <div
                    className="w-4 bg-blue-500 rounded-t hover:bg-blue-600 transition-colors relative group cursor-pointer"
                    style={{ height: `${Math.max(heightPercent, 2)}%` }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                      {day.count} queries
                      {day.errors !== undefined && day.errors > 0 && `, ${day.errors} errors`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex ml-10 mt-1 justify-around px-1 overflow-hidden">
        {data.slice(-14).map((day, i) => (
          <div key={i} className="flex-1 max-w-[40px] text-center">
            <span className="text-xs text-gray-500">
              {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthScoreBadge({ score }: { score: number }) {
  let color = "bg-green-100 text-green-800";
  if (score < 70) color = "bg-yellow-100 text-yellow-800";
  if (score < 50) color = "bg-red-100 text-red-800";

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${color}`}>
      {score}
    </span>
  );
}

function FlagBadge({ flag }: { flag: TenantHealthFlag }) {
  const config: Record<TenantHealthFlag, { color: string; label: string }> = {
    high_error_rate: { color: "bg-red-100 text-red-800 border-red-200", label: "High Errors" },
    kb_quota_warning: { color: "bg-yellow-100 text-yellow-800 border-yellow-200", label: "KB Quota" },
    agent_quota_warning: { color: "bg-yellow-100 text-yellow-800 border-yellow-200", label: "Agent Quota" },
    upload_quota_warning: { color: "bg-orange-100 text-orange-800 border-orange-200", label: "Upload Quota" },
    scrape_quota_warning: { color: "bg-orange-100 text-orange-800 border-orange-200", label: "Scrape Quota" },
    high_rate_limiting: { color: "bg-red-100 text-red-800 border-red-200", label: "Rate Limiting" },
    low_activity: { color: "bg-gray-100 text-gray-800 border-gray-200", label: "Low Activity" },
  };

  const { color, label } = config[flag];

  return (
    <Badge variant="outline" className={`text-xs ${color}`}>
      {label}
    </Badge>
  );
}

function getFlagLabel(flag: TenantHealthFlag): string {
  const labels: Record<TenantHealthFlag, string> = {
    high_error_rate: "High Error Rate",
    kb_quota_warning: "KB Quota Warning",
    agent_quota_warning: "Agent Quota Warning",
    upload_quota_warning: "Upload Quota Warning",
    scrape_quota_warning: "Scrape Quota Warning",
    high_rate_limiting: "High Rate Limiting",
    low_activity: "Low Activity",
  };
  return labels[flag];
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div className="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="animate-pulse h-48 bg-gray-200 rounded"></div>
      </div>
    </div>
  );
}
