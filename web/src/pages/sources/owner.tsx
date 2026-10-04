/*
 * A data source's owner: a team, or the platform (shared sources managed in
 * the admin portal). The source pages (list, create dialog, detail,
 * documents, crawls) are written once against this interface; the owner
 * supplies the API calls, query keys, links and permissions.
 */
import { type QueryKey, queryOptions } from "@tanstack/react-query";
import { Link, type useNavigate } from "@tanstack/react-router";
import { type ReactElement, type ReactNode, createContext, useContext, useMemo } from "react";
import { api, ifMatch, unwrap, type Schemas } from "../../api/client";
import type { paths } from "../../api/schema.gen";
import { sharedSourceKey } from "../../api/queries";
import { Alert } from "@/components/ui/alert/alert";
import { TeamContext, type TeamCtx, documentsKey, kbsKey, sourceKey, sourcesKey } from "../team/common";
import { readOnlyText } from "../team/access";

export type DataSource = Schemas["DataSource"];
export type Crawl = Schemas["Crawl"];
export type WebConfig = Schemas["WebConfig"];
export type WebConfigInput = Schemas["WebConfigInput"];
export type MapRequest = Schemas["MapRequest"];
type MapResult = Schemas["MapResult"];
export type ClassificationImpact = Schemas["ClassificationImpact"];
type DocumentPage = Schemas["DocumentPage"];
type DocQuery = { status?: Schemas["DocumentStatus"]; q?: string; kind?: DocKind; tag?: string; errorCode?: string; cursor?: string; limit?: number };
/** A document kind the documents list can filter on (?kind=). */
export type DocKind = NonNullable<NonNullable<paths["/v1/teams/{team}/sources/{sourceId}/documents"]["get"]["parameters"]["query"]>["kind"]>;
export type PassagePage = Schemas["DocumentPassagePage"];

export type SourceApi = {
  list(): Promise<DataSource[]>;
  get(id: string): Promise<DataSource>;
  create(body: Schemas["DataSourceCreate"]): Promise<DataSource>;
  update(src: DataSource, body: Schemas["DataSourceUpdate"]): Promise<DataSource>;
  /** Platform only: the classification change's impact on team knowledge bases, without changing anything. */
  previewClassification?(src: DataSource, classification: string): Promise<ClassificationImpact>;
  remove(id: string): Promise<void>;
  documents(id: string, query: DocQuery): Promise<DocumentPage>;
  document(id: string, documentId: string): Promise<Schemas["Document"]>;
  /** A document's first passages, in order. */
  passages(id: string, documentId: string, limit?: number): Promise<PassagePage>;
  /** The tags a source's documents use (the documents filter). */
  tags(id: string): Promise<string[]>;
  retryDocument(id: string, documentId: string): Promise<unknown>;
  /** Queues every failed or skipped document with the error code again (needs_ocr). */
  retryDocuments(id: string, errorCode: "needs_ocr"): Promise<Schemas["DocumentRetryResult"]>;
  /** Fetches one page of a web source again now (a crawl run of just that URL, W3). */
  refetchDocument(id: string, documentId: string): Promise<Crawl>;
  deleteDocument(id: string, documentId: string): Promise<unknown>;
  /** Replaces a document's tags. */
  updateDocument(id: string, documentId: string, body: Schemas["DocumentUpdate"]): Promise<Schemas["Document"]>;
  /** The multipart upload URL (uploads use XMLHttpRequest for progress). */
  uploadPath(id: string): string;
  sync(id: string): Promise<Crawl>;
  crawls(id: string): Promise<Crawl[]>;
  cancelCrawl(id: string, crawlId: string): Promise<Crawl>;
  /** The most repeated blocks left out of the source's chunks (ADR-0021). */
  boilerplate(id: string): Promise<Schemas["BoilerplateBlock"][]>;
  /** Team only: discovery preview for a crawl. */
  map?(body: MapRequest): Promise<MapResult>;
};

type Navigate = ReturnType<typeof useNavigate>;

export type SourceOwner = {
  kind: "team" | "platform";
  /** The team slug (team sources only). */
  team?: string;
  /** Create, change, sync and delete sources. */
  canEdit: boolean;
  /** Lower a classification (with a reason): team admins/owners, platform admins. */
  canLower: boolean;
  /** Highest classification the owner may use; undefined = every level. */
  maxClassification?: string;
  /** Explains why the pages are read-only, or null. */
  readOnlyNote: ReactNode;
  api: SourceApi;
  keys: {
    list: QueryKey;
    source: (id: string) => QueryKey;
    documents: (id: string) => QueryKey;
    crawls: (id: string) => QueryKey;
    /** Other queries that show source data (knowledge bases, catalogs). */
    related: QueryKey[];
  };
  /** A router link to a source's page, for `render` props. */
  sourceLink: (id: string) => ReactElement;
  /** Goes to a source's page, or the list when id is omitted. `replace` swaps the current history entry (a finished form page). */
  go: (navigate: Navigate, id?: string, opts?: { replace?: boolean }) => void;
};

const enc = encodeURIComponent;

function teamOwner(ctx: TeamCtx): SourceOwner {
  const team = ctx.slug;
  const p = (sourceId: string) => ({ path: { team, sourceId } });
  const readOnlyNote = ctx.archived ? (
    <Alert tone="warning" title="This team is archived">
      Its data sources are read-only.
    </Alert>
  ) : ctx.role === "member" ? (
    <Alert tone="info">{readOnlyText("member", "data sources")}</Alert>
  ) : !ctx.role ? (
    // A platform admin reading under break-glass (ADR-0024).
    <Alert tone="info">You're reading this team's data sources under break-glass: read-only, and every read is recorded.</Alert>
  ) : null;
  return {
    kind: "team",
    team,
    canEdit: ctx.canEdit,
    canLower: ctx.isManager,
    maxClassification: ctx.team.maxClassification,
    readOnlyNote,
    api: {
      list: async () => unwrap(await api.GET("/v1/teams/{team}/sources", { params: { path: { team } } })),
      get: async (id) => unwrap(await api.GET("/v1/teams/{team}/sources/{sourceId}", { params: p(id) })),
      create: async (body) => unwrap(await api.POST("/v1/teams/{team}/sources", { params: { path: { team } }, body })),
      update: async (src, body) =>
        unwrap(await api.PATCH("/v1/teams/{team}/sources/{sourceId}", { params: { ...p(src.id), header: ifMatch(src.revision) }, body })),
      remove: async (id) => {
        unwrap(await api.DELETE("/v1/teams/{team}/sources/{sourceId}", { params: p(id) }));
      },
      documents: async (id, query) => unwrap(await api.GET("/v1/teams/{team}/sources/{sourceId}/documents", { params: { ...p(id), query } })),
      document: async (id, documentId) =>
        unwrap(await api.GET("/v1/teams/{team}/sources/{sourceId}/documents/{documentId}", { params: { path: { team, sourceId: id, documentId } } })),
      passages: async (id, documentId, limit) =>
        unwrap(
          await api.GET("/v1/teams/{team}/sources/{sourceId}/documents/{documentId}/passages", {
            params: { path: { team, sourceId: id, documentId }, query: { limit } },
          }),
        ),
      tags: async (id) => unwrap(await api.GET("/v1/teams/{team}/sources/{sourceId}/tags", { params: p(id) })),
      retryDocument: async (id, documentId) =>
        unwrap(await api.POST("/v1/teams/{team}/sources/{sourceId}/documents/{documentId}/retry", { params: { path: { team, sourceId: id, documentId } } })),
      retryDocuments: async (id, errorCode) =>
        unwrap(await api.POST("/v1/teams/{team}/sources/{sourceId}/documents/retry", { params: p(id), body: { errorCode } })),
      refetchDocument: async (id, documentId) =>
        unwrap(await api.POST("/v1/teams/{team}/sources/{sourceId}/documents/{documentId}/refetch", { params: { path: { team, sourceId: id, documentId } } })),
      deleteDocument: async (id, documentId) =>
        unwrap(await api.DELETE("/v1/teams/{team}/sources/{sourceId}/documents/{documentId}", { params: { path: { team, sourceId: id, documentId } } })),
      updateDocument: async (id, documentId, body) =>
        unwrap(await api.PATCH("/v1/teams/{team}/sources/{sourceId}/documents/{documentId}", { params: { path: { team, sourceId: id, documentId } }, body })),
      uploadPath: (id) => `/v1/teams/${enc(team)}/sources/${enc(id)}/documents`,
      sync: async (id) => unwrap(await api.POST("/v1/teams/{team}/sources/{sourceId}/sync", { params: p(id) })),
      crawls: async (id) => unwrap(await api.GET("/v1/teams/{team}/sources/{sourceId}/crawls", { params: { ...p(id), query: { limit: 20 } } })),
      cancelCrawl: async (id, crawlId) =>
        unwrap(await api.POST("/v1/teams/{team}/sources/{sourceId}/crawls/{crawlId}/cancel", { params: { path: { team, sourceId: id, crawlId } } })),
      boilerplate: async (id) =>
        unwrap(await api.GET("/v1/teams/{team}/sources/{sourceId}/boilerplate", { params: { ...p(id), query: { limit: 20 } } })),
      map: async (body) => unwrap(await api.POST("/v1/teams/{team}/web/map", { params: { path: { team } }, body })),
    },
    keys: {
      list: sourcesKey(team),
      source: (id) => sourceKey(team, id),
      documents: (id) => documentsKey(team, id),
      crawls: (id) => [...sourceKey(team, id), "crawls"],
      related: [kbsKey(team), ["team", team, "kb"]],
    },
    sourceLink: (id) => <Link to="/teams/$team/sources/$sourceId" params={{ team, sourceId: id }} />,
    go: (navigate, id, opts) =>
      void (id
        ? navigate({ to: "/teams/$team/sources/$sourceId", params: { team, sourceId: id }, replace: opts?.replace })
        : navigate({ to: "/teams/$team/sources", params: { team }, replace: opts?.replace })),
  };
}

const sharedSourcesKey = ["admin", "shared-sources"];

/** Shared sources, managed by platform admins (auditors read). */
export function platformOwner(isAdmin: boolean): SourceOwner {
  const p = (sourceId: string) => ({ path: { sourceId } });
  return {
    kind: "platform",
    canEdit: isAdmin,
    canLower: isAdmin,
    readOnlyNote: isAdmin ? null : <Alert tone="info">Auditors can view shared sources. Only platform admins can change them.</Alert>,
    api: {
      list: async () => unwrap(await api.GET("/v1/admin/shared-sources")),
      get: async (id) => unwrap(await api.GET("/v1/admin/shared-sources/{sourceId}", { params: p(id) })),
      create: async (body) => unwrap(await api.POST("/v1/admin/shared-sources", { body })),
      update: async (src, body) =>
        unwrap(await api.PATCH("/v1/admin/shared-sources/{sourceId}", { params: { ...p(src.id), header: ifMatch(src.revision) }, body })) as DataSource,
      previewClassification: async (src, classification) =>
        unwrap(
          await api.PATCH("/v1/admin/shared-sources/{sourceId}", {
            params: { ...p(src.id), header: ifMatch(src.revision), query: { preview: true } },
            body: { classification },
          }),
        ) as ClassificationImpact,
      remove: async (id) => {
        unwrap(await api.DELETE("/v1/admin/shared-sources/{sourceId}", { params: p(id) }));
      },
      documents: async (id, query) => unwrap(await api.GET("/v1/admin/shared-sources/{sourceId}/documents", { params: { ...p(id), query } })),
      document: async (id, documentId) => unwrap(await api.GET("/v1/admin/shared-sources/{sourceId}/documents/{documentId}", { params: { path: { sourceId: id, documentId } } })),
      passages: async (id, documentId, limit) =>
        unwrap(await api.GET("/v1/admin/shared-sources/{sourceId}/documents/{documentId}/passages", { params: { path: { sourceId: id, documentId }, query: { limit } } })),
      tags: async (id) => unwrap(await api.GET("/v1/admin/shared-sources/{sourceId}/tags", { params: p(id) })),
      retryDocument: async (id, documentId) =>
        unwrap(await api.POST("/v1/admin/shared-sources/{sourceId}/documents/{documentId}/retry", { params: { path: { sourceId: id, documentId } } })),
      retryDocuments: async (id, errorCode) => unwrap(await api.POST("/v1/admin/shared-sources/{sourceId}/documents/retry", { params: p(id), body: { errorCode } })),
      refetchDocument: async (id, documentId) =>
        unwrap(await api.POST("/v1/admin/shared-sources/{sourceId}/documents/{documentId}/refetch", { params: { path: { sourceId: id, documentId } } })),
      deleteDocument: async (id, documentId) =>
        unwrap(await api.DELETE("/v1/admin/shared-sources/{sourceId}/documents/{documentId}", { params: { path: { sourceId: id, documentId } } })),
      updateDocument: async (id, documentId, body) =>
        unwrap(await api.PATCH("/v1/admin/shared-sources/{sourceId}/documents/{documentId}", { params: { path: { sourceId: id, documentId } }, body })),
      uploadPath: (id) => `/v1/admin/shared-sources/${enc(id)}/documents`,
      sync: async (id) => unwrap(await api.POST("/v1/admin/shared-sources/{sourceId}/sync", { params: p(id) })),
      crawls: async (id) => unwrap(await api.GET("/v1/admin/shared-sources/{sourceId}/crawls", { params: { ...p(id), query: { limit: 20 } } })),
      cancelCrawl: async (id, crawlId) =>
        unwrap(await api.POST("/v1/admin/shared-sources/{sourceId}/crawls/{crawlId}/cancel", { params: { path: { sourceId: id, crawlId } } })),
      boilerplate: async (id) =>
        unwrap(await api.GET("/v1/admin/shared-sources/{sourceId}/boilerplate", { params: { ...p(id), query: { limit: 20 } } })),
    },
    keys: {
      list: sharedSourcesKey,
      source: sharedSourceKey,
      documents: (id) => [...sharedSourceKey(id), "documents"],
      crawls: (id) => [...sharedSourceKey(id), "crawls"],
      related: [["shared-sources"]],
    },
    sourceLink: (id) => <Link to="/admin/shared-sources/$sourceId" params={{ sourceId: id }} />,
    go: (navigate, id, opts) =>
      void (id
        ? navigate({ to: "/admin/shared-sources/$sourceId", params: { sourceId: id }, replace: opts?.replace })
        : navigate({ to: "/admin/shared-sources", replace: opts?.replace })),
  };
}

export const SourceOwnerContext = createContext<SourceOwner | null>(null);

/**
 * The owner of the sources on this page: the nearest SourceOwnerContext, or
 * else the current team (so team pages need no extra provider).
 */
export function useSourceOwner(): SourceOwner {
  const owner = useContext(SourceOwnerContext);
  const team = useContext(TeamContext);
  return useMemo(() => {
    if (owner) return owner;
    if (team) return teamOwner(team);
    throw new Error("useSourceOwner called outside a team or a SourceOwnerContext");
  }, [owner, team]);
}

/** The query for one source of the current owner. */
export const ownerSourceQuery = (owner: SourceOwner, id: string) =>
  queryOptions({ queryKey: owner.keys.source(id), queryFn: () => owner.api.get(id) });
