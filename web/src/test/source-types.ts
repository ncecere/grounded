import type { Schemas } from "../api/client";

/** The source types every install has (GET /v1/source-types), unless a test gives its own list. */
export const builtInSourceTypes: Schemas["SourceType"][] = [
  { key: "upload", name: "Upload", description: "Files added by hand or through the API", builtIn: true, enabled: true, credentials: [],
    capabilities: { uploads: true, sync: false, webPages: false, permissions: "none", shared: true } },
  { key: "web", name: "Website", description: "Public web pages, fetched by the crawler", builtIn: true, enabled: true, credentials: [],
    capabilities: { uploads: false, sync: true, webPages: true, permissions: "none", shared: true } },
];
