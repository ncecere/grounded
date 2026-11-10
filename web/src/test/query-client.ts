/* The tests' query client: no retries (a failed request fails at once), and the app's own freshness window (main.tsx). */
import { QueryClient } from "@tanstack/react-query";
import { defaultStaleTime } from "../lib/query-defaults";

export const testQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: defaultStaleTime } } });
