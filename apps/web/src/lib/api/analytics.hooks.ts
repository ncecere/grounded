import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "./analytics";
import type { TestSuiteAnalytics } from "./types";

export const analyticsKeys = {
  all: ["analytics"] as const,
  testSuites: (params?: { startDate?: string; endDate?: string }) => [
    "analytics",
    "test-suites",
    params?.startDate ?? null,
    params?.endDate ?? null,
  ] as const,
};

export const useTestSuiteAnalytics = (params?: { startDate?: string; endDate?: string }) =>
  useQuery<TestSuiteAnalytics>({
    queryKey: analyticsKeys.testSuites(params),
    queryFn: () => analyticsApi.getTestSuiteAnalytics(params),
  });
