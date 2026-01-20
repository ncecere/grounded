import { request } from "./client";
import type { AnalyticsData, TestSuiteAnalytics } from "./types";

export const analyticsApi = {
  getAnalytics: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    const query = searchParams.toString();
    return request<AnalyticsData>(`/analytics${query ? `?${query}` : ""}`);
  },
  getTestSuiteAnalytics: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    const query = searchParams.toString();
    return request<TestSuiteAnalytics>(`/analytics/test-suites${query ? `?${query}` : ""}`);
  },
};
