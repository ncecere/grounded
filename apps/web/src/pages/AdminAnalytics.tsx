import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  type TenantHealthFlag,
} from "../lib/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { PageHeader } from "../components/ui/page-header";
import { StatCard } from "../components/ui/stat-card";
import { LoadingSkeleton } from "../components/ui/loading-skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  ArrowLeft,
  Download,
  AlertTriangle,
  CheckCircle,
  Building2,
  BarChart3,
  Clock,
  Zap,
  Database,
  Users,
  Bot,
  MessageSquare,
  FileText,
  Globe,
} from "lucide-react";

export function AdminAnalytics() {
  const [activeTab, setActiveTab] = useState<string>("overview");
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
        <PageHeader
          title="Analytics"
          description="System-wide usage metrics and tenant health monitoring"
          className="mb-0"
        />
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={dateRange.startDate}
            onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:ring-primary"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            value={dateRange.endDate}
            onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:ring-primary"
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="tenants" className="gap-2">
            <Building2 className="w-4 h-4" />
            Tenants
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <OverviewTab
            dateRange={dateRange}
            onExport={handleExportOverview}
          />
        </TabsContent>
        <TabsContent value="tenants" className="mt-6">
          <TenantsTab
            dateRange={dateRange}
            onSelectTenant={(id) => setSelectedTenantId(id)}
            onExport={handleExportTenants}
          />
        </TabsContent>
      </Tabs>
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
    return <LoadingSkeleton variant="stats" count={4} />;
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">Failed to load analytics data</p>
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
          icon={MessageSquare}
          iconColor="primary"
          label="Total Queries"
          value={overview.totalQueries.toLocaleString()}
        />
        <StatCard
          icon={CheckCircle}
          iconColor="success"
          label="Successful"
          value={overview.successfulQueries.toLocaleString()}
          subtext={`${overview.errorRate.toFixed(1)}% error rate`}
        />
        <StatCard
          icon={Clock}
          iconColor="muted"
          label="Avg Latency"
          value={`${(overview.avgLatencyMs / 1000).toFixed(2)}s`}
        />
        <StatCard
          icon={Zap}
          iconColor="warning"
          label="Total Tokens"
          value={formatNumber(overview.totalTokens)}
          subtext={`${formatNumber(overview.promptTokens)} / ${formatNumber(overview.completionTokens)}`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          icon={Building2}
          iconColor="primary"
          label="Active Tenants"
          value={overview.activeTenants.toString()}
        />
        <StatCard
          icon={Bot}
          iconColor="success"
          label="Active Agents"
          value={overview.activeAgents.toString()}
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Queries Over Time */}
        <Card>
          <CardHeader>
            <CardTitle>Queries Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {queriesByDay && queriesByDay.length > 0 ? (
              <QueryChart data={queriesByDay} />
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground">
                No data available for this period
              </div>
            )}
          </CardContent>
        </Card>

        {/* Queries by Channel */}
        <Card>
          <CardHeader>
            <CardTitle>Queries by Channel</CardTitle>
          </CardHeader>
          <CardContent>
            {queriesByChannel && queriesByChannel.length > 0 ? (
              <div className="space-y-4">
                {queriesByChannel.map((channel) => {
                  const total = queriesByChannel.reduce((sum, c) => sum + c.count, 0);
                  const percent = total > 0 ? (channel.count / total) * 100 : 0;
                  return (
                    <div key={channel.channel} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium capitalize">{channel.channel.replace("_", " ")}</span>
                        <span className="text-muted-foreground">{channel.count.toLocaleString()} ({percent.toFixed(1)}%)</span>
                      </div>
                      <Progress value={percent} className="h-2" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Tenants */}
      <Card>
        <CardHeader>
          <CardTitle>Top Tenants by Queries</CardTitle>
        </CardHeader>
        <CardContent>
          {topTenants && topTenants.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="text-right">Queries</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Error Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topTenants.map((tenant) => (
                  <TableRow key={tenant.tenantId}>
                    <TableCell className="font-medium">{tenant.tenantName}</TableCell>
                    <TableCell className="text-right">{tenant.queries.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{tenant.errors.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <span className={tenant.errorRate > 10 ? "text-destructive font-medium" : ""}>
                        {tenant.errorRate.toFixed(1)}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No tenant data available
            </div>
          )}
        </CardContent>
      </Card>
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
    return <LoadingSkeleton variant="stats" count={4} />;
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">Failed to load tenant data</p>
      </div>
    );
  }

  const { tenants, summary } = data;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Tenants</p>
                <p className="text-2xl font-bold text-foreground">{summary.total}</p>
              </div>
              <Building2 className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Healthy</p>
                <p className="text-2xl font-bold text-success">{summary.healthy}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">With Warnings</p>
                <p className="text-2xl font-bold text-warning">{summary.withWarnings}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-warning" />
            </div>
          </CardContent>
        </Card>
        <Card className="flex items-center justify-center">
          <CardContent className="pt-6">
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Flag Summary */}
      {summary.withWarnings > 0 && (
        <div className="bg-warning/10 border border-warning/20 rounded-lg p-4">
          <h4 className="font-medium text-foreground mb-2">Warning Flags Summary</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.flagCounts).map(([flag, count]) => {
              if (count === 0) return null;
              return (
                <Badge key={flag} variant="outline" className="bg-warning/20 border-warning/30">
                  {getFlagLabel(flag as TenantHealthFlag)}: {count}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Tenants Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead className="text-center">Health</TableHead>
              <TableHead className="text-right">Queries</TableHead>
              <TableHead className="text-right">Error Rate</TableHead>
              <TableHead className="text-right">KBs</TableHead>
              <TableHead className="text-right">Agents</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((tenant) => (
              <TableRow
                key={tenant.id}
                className="cursor-pointer"
                onClick={() => onSelectTenant(tenant.id)}
              >
                <TableCell>
                  <div>
                    <p className="font-medium">{tenant.name}</p>
                    <p className="text-sm text-muted-foreground">{tenant.slug}</p>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <HealthScoreBadge score={tenant.healthScore} />
                </TableCell>
                <TableCell className="text-right">
                  {tenant.usage.totalQueries.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  <span className={tenant.usage.errorRate > 10 ? "text-destructive font-medium" : ""}>
                    {tenant.usage.errorRate.toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className={tenant.resources.kbs >= tenant.resources.maxKbs * 0.8 ? "text-warning" : ""}>
                    {tenant.resources.kbs}/{tenant.resources.maxKbs}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className={tenant.resources.agents >= tenant.resources.maxAgents * 0.8 ? "text-warning" : ""}>
                    {tenant.resources.agents}/{tenant.resources.maxAgents}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {tenant.flags.map((flag) => (
                      <FlagBadge key={flag} flag={flag} />
                    ))}
                    {tenant.flags.length === 0 && (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
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
        <LoadingSkeleton variant="page" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Button
          variant="ghost"
          onClick={onBack}
          className="mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Tenants
        </Button>
        <p className="text-destructive">Failed to load tenant data</p>
      </div>
    );
  }

  const { tenant, resources, quotas, currentUsage, stats, queriesByDay, queriesByChannel, byAgent, historicalUsage } = data;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Button
            variant="ghost"
            onClick={onBack}
            className="mb-2 -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Tenants
          </Button>
          <h1 className="text-2xl font-bold text-foreground">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">{tenant.slug}</p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          Created: {new Date(tenant.createdAt).toLocaleDateString()}
        </div>
      </div>

      {/* Resource Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <StatCard icon={Users} iconColor="primary" label="Members" value={resources.members.toString()} />
        <StatCard icon={Database} iconColor="muted" label="Knowledge Bases" value={`${resources.kbs}/${quotas.maxKbs}`} />
        <StatCard icon={Bot} iconColor="success" label="Agents" value={`${resources.agents}/${quotas.maxAgents}`} />
        <StatCard icon={Globe} iconColor="primary" label="Sources" value={resources.sources.toString()} />
        <StatCard icon={FileText} iconColor="warning" label="Chunks" value={formatNumber(resources.chunks)} />
      </div>

      {/* Query Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={MessageSquare} iconColor="primary" label="Total Queries" value={stats.totalQueries.toLocaleString()} />
        <StatCard
          icon={CheckCircle}
          iconColor="success"
          label="Success Rate"
          value={`${(100 - stats.errorRate).toFixed(1)}%`}
          subtext={`${stats.errorQueries} errors`}
        />
        <StatCard
          icon={Clock}
          iconColor="muted"
          label="Latency (p50/p95)"
          value={`${(stats.p50LatencyMs / 1000).toFixed(2)}s`}
          subtext={`p95: ${(stats.p95LatencyMs / 1000).toFixed(2)}s`}
        />
        <StatCard icon={Zap} iconColor="warning" label="Tokens Used" value={formatNumber(stats.totalTokens)} />
      </div>

      {/* Usage Quotas */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Quota Usage ({currentUsage.month})</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Queries Over Time */}
        <Card>
          <CardHeader>
            <CardTitle>Queries Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {queriesByDay && queriesByDay.length > 0 ? (
              <QueryChart data={queriesByDay} />
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Channel Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Queries by Channel</CardTitle>
          </CardHeader>
          <CardContent>
            {queriesByChannel && queriesByChannel.length > 0 ? (
              <div className="space-y-4">
                {queriesByChannel.map((channel) => {
                  const total = queriesByChannel.reduce((sum, c) => sum + c.count, 0);
                  const percent = total > 0 ? (channel.count / total) * 100 : 0;
                  return (
                    <div key={channel.channel} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium capitalize">{channel.channel.replace("_", " ")}</span>
                        <span className="text-muted-foreground">
                          {channel.count.toLocaleString()} ({percent.toFixed(1)}%)
                          {channel.errors > 0 && (
                            <span className="text-destructive ml-2">
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
              <div className="h-48 flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agents Table */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {byAgent && byAgent.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Queries</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Error Rate</TableHead>
                  <TableHead className="text-right">Avg Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byAgent.map((agent) => (
                  <TableRow key={agent.agentId}>
                    <TableCell className="font-medium">{agent.agentName}</TableCell>
                    <TableCell className="text-right">{agent.queries.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{agent.errors}</TableCell>
                    <TableCell className="text-right">
                      <span className={agent.errorRate > 10 ? "text-destructive font-medium" : ""}>
                        {agent.errorRate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{(agent.avgLatency / 1000).toFixed(2)}s</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No agent data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historical Usage */}
      {historicalUsage && historicalUsage.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historical Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Uploads</TableHead>
                  <TableHead className="text-right">Scraped</TableHead>
                  <TableHead className="text-right">Chat Requests</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historicalUsage.map((usage) => (
                  <TableRow key={usage.month}>
                    <TableCell className="font-medium">{usage.month}</TableCell>
                    <TableCell className="text-right">{usage.uploadedDocs.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{usage.scrapedPages.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{usage.chatRequests.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {formatNumber(usage.promptTokens + usage.completionTokens)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Shared Components
// ============================================================================

function QueryChart({ data }: { data: Array<{ date: string; count: number; errors?: number }> }) {
  const maxCount = Math.max(...data.map((d) => d.count));
  const yMax = Math.max(maxCount, 1);
  const yLabels = [yMax, Math.round(yMax * 0.75), Math.round(yMax * 0.5), Math.round(yMax * 0.25), 0];

  return (
    <div className="h-48">
      <div className="flex h-40">
        <div className="flex flex-col justify-between text-xs text-muted-foreground pr-2 py-1 w-10">
          {yLabels.map((val, i) => (
            <span key={i} className="text-right">{formatNumber(val)}</span>
          ))}
        </div>
        <div className="flex-1 border-l border-b border-border relative">
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {yLabels.map((_, i) => (
              <div key={i} className="border-t border-border/50 w-full" />
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
                    className="w-4 bg-primary rounded-t hover:bg-primary/80 transition-colors relative group cursor-pointer"
                    style={{ height: `${Math.max(heightPercent, 2)}%` }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded border border-border shadow-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
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
            <span className="text-xs text-muted-foreground">
              {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthScoreBadge({ score }: { score: number }) {
  let className = "bg-success/15 text-success";
  if (score < 70) className = "bg-warning/15 text-warning";
  if (score < 50) className = "bg-destructive/15 text-destructive";

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${className}`}>
      {score}
    </span>
  );
}

function FlagBadge({ flag }: { flag: TenantHealthFlag }) {
  const config: Record<TenantHealthFlag, { color: string; label: string }> = {
    high_error_rate: { color: "bg-destructive/15 text-destructive border-destructive/20", label: "High Errors" },
    kb_quota_warning: { color: "bg-warning/15 text-warning border-warning/20", label: "KB Quota" },
    agent_quota_warning: { color: "bg-warning/15 text-warning border-warning/20", label: "Agent Quota" },
    upload_quota_warning: { color: "bg-warning/15 text-warning border-warning/20", label: "Upload Quota" },
    scrape_quota_warning: { color: "bg-warning/15 text-warning border-warning/20", label: "Scrape Quota" },
    high_rate_limiting: { color: "bg-destructive/15 text-destructive border-destructive/20", label: "Rate Limiting" },
    low_activity: { color: "bg-muted text-muted-foreground border-border", label: "Low Activity" },
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
