import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function Analytics() {
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
  });

  const { data: analytics, isLoading } = useQuery({
    queryKey: ["analytics", dateRange],
    queryFn: () => api.getAnalytics(dateRange),
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
          <div className="h-64 bg-gray-200 rounded-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monitor usage and performance metrics
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

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Queries</p>
              <p className="text-2xl font-bold text-gray-900">{analytics?.totalQueries ?? 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-500">Conversations</p>
              <p className="text-2xl font-bold text-gray-900">{analytics?.totalConversations ?? 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-500">Avg Response Time</p>
              <p className="text-2xl font-bold text-gray-900">
                {analytics?.avgResponseTime ? `${(analytics.avgResponseTime / 1000).toFixed(1)}s` : "N/A"}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-500">Queries/Day</p>
              <p className="text-2xl font-bold text-gray-900">
                {analytics?.queriesByDay?.length
                  ? Math.round(
                      analytics.queriesByDay.reduce((sum, d) => sum + d.count, 0) /
                        analytics.queriesByDay.length
                    )
                  : 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Queries Over Time */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Queries Over Time</h3>
          {analytics?.queriesByDay && analytics.queriesByDay.length > 0 ? (
            <div className="h-64 flex items-end gap-1">
              {analytics.queriesByDay.map((day, i) => {
                const maxCount = Math.max(...analytics.queriesByDay.map((d) => d.count));
                const height = maxCount > 0 ? (day.count / maxCount) * 100 : 0;
                return (
                  <div
                    key={i}
                    className="flex-1 bg-blue-500 rounded-t hover:bg-blue-600 transition-colors relative group"
                    style={{ height: `${Math.max(height, 2)}%` }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      {day.date}: {day.count}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-500">
              No data available for this period
            </div>
          )}
        </div>

        {/* Top Queries */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Queries</h3>
          {analytics?.topQueries && analytics.topQueries.length > 0 ? (
            <div className="space-y-3">
              {analytics.topQueries.slice(0, 10).map((query, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 truncate flex-1 mr-4">{query.query}</span>
                  <span className="text-sm font-medium text-gray-500">{query.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-500">
              No queries recorded yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
