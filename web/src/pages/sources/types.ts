/*
 * Source types (docs/source-types.md): upload and web are built in; every other type is a connector, described by the
 * server (GET /v1/source-types). Pages ask what kind a source is instead of comparing its type with a name.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";

export type SourceTypeInfo = Schemas["SourceType"];

/** How a source's pages behave: files are uploaded, pages are crawled, or a connector syncs. */
export type SourceKind = "upload" | "web" | "connector";

export const kindOf = (type: string): SourceKind => (type === "web" ? "web" : type === "upload" ? "upload" : "connector");

export const sourceTypesKey = ["source-types"];

/** The types this server has, the built-in ones first. They change only when a platform admin turns one on or off. */
export const sourceTypesQuery = queryOptions({
  queryKey: sourceTypesKey,
  queryFn: async () => unwrap(await api.GET("/v1/source-types")),
  staleTime: 60_000,
});

export function useSourceTypes() {
  return useQuery(sourceTypesQuery);
}

const builtInNames: Record<string, string> = { upload: "Upload", web: "Website" };

/** A type's name: "Upload", "Website", or the connector's own. A type this server doesn't have keeps its key. */
export function typeName(types: SourceTypeInfo[] | undefined, type: string): string {
  return builtInNames[type] ?? types?.find((t) => t.key === type)?.name ?? type;
}

/** What a source's documents are called: pages for a website, documents for everything else. */
export const itemNoun = (type: string): "page" | "document" => (type === "web" ? "page" : "document");

export const syncScheduleLabels: Record<Schemas["SyncSchedule"], string> = { manual: "Manual only", hourly: "Hourly", daily: "Daily", weekly: "Weekly" };
