/*
 * How long a fetched answer counts as fresh, for every query that doesn't say otherwise (main.tsx). Without one, every
 * mount of a list, a dialog or a tab asked the server again, although mutations already invalidate what they change.
 * A query whose data changes without a mutation here (a conversation the chat adds to) sets its own staleTime.
 * The tests' query clients use the same value (test/query-client.ts), so a page that needs a fresh read on mount fails
 * there, not in production.
 */
export const defaultStaleTime = 15_000;
