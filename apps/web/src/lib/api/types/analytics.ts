export interface AnalyticsData {
  totalQueries: number;
  totalConversations: number;
  avgResponseTime: number;
  topQueries: Array<{ query: string; count: number }>;
  queriesByDay: Array<{ date: string; count: number }>;
}
