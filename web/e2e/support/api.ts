import { type APIRequestContext, type APIResponse, request } from "@playwright/test";
import type { components } from "../../src/api/schema.gen";
import { type Persona, baseURL } from "./env";

export type Schemas = components["schemas"];

type Options = { headers?: Record<string, string>; expect?: number };

/**
 * A persona's API session for arranging state the spec isn't about (seeding,
 * teams, members). Unsafe requests carry the Origin and the session's CSRF
 * token, as the web app's do.
 */
export class Api {
  private constructor(
    readonly ctx: APIRequestContext,
    private csrf: string,
    readonly persona: Persona,
  ) {}

  /** Signs in with development sign-in (POST /auth/dev). */
  static async signIn(persona: Persona): Promise<Api> {
    const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
    const res = await ctx.post("/auth/dev", { data: { account: persona } });
    if (!res.ok()) throw new Error(`sign in ${persona}: ${res.status()} ${await res.text()}`);
    const api = new Api(ctx, "", persona);
    await api.refresh();
    return api;
  }

  async refresh() {
    const me = await this.get<Schemas["Me"]>("/v1/me");
    this.csrf = me.csrfToken;
    return me;
  }

  async dispose() {
    await this.ctx.dispose();
  }

  get<T>(path: string, opts?: Options) {
    return this.call<T>("GET", path, undefined, opts);
  }
  post<T>(path: string, body?: unknown, opts?: Options) {
    return this.call<T>("POST", path, body ?? {}, opts);
  }
  put<T>(path: string, body?: unknown, opts?: Options) {
    return this.call<T>("PUT", path, body ?? {}, opts);
  }
  patch<T>(path: string, body?: unknown, opts?: Options) {
    return this.call<T>("PATCH", path, body ?? {}, opts);
  }
  del<T>(path: string, opts?: Options) {
    return this.call<T>("DELETE", path, undefined, opts);
  }

  /** PUTs a revisioned resource (If-Match from the current revision). */
  async putRevised<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const cur = await this.get<{ revision: number }>(path);
    return this.put<T>(path, body, { headers: { "If-Match": `"${cur.revision}"` } });
  }

  /** Uploads files to an upload source (multipart "files"). */
  async upload(team: string, sourceId: string, files: { name: string; body: string }[]) {
    const form = new FormData();
    for (const f of files) form.append("files", new Blob([f.body], { type: "text/markdown" }), f.name);
    const res = await this.ctx.post(`/v1/teams/${team}/sources/${sourceId}/documents`, { headers: { "X-CSRF-Token": this.csrf }, multipart: form });
    return this.unwrap<Schemas["UploadResult"][]>(res, "POST upload");
  }

  private async call<T>(method: string, path: string, body: unknown, opts?: Options): Promise<T> {
    const headers: Record<string, string> = { ...opts?.headers };
    if (method !== "GET") headers["X-CSRF-Token"] = this.csrf;
    const res = await this.ctx.fetch(path, { method, headers, ...(body !== undefined ? { data: body } : {}) });
    return this.unwrap<T>(res, `${method} ${path}`, opts?.expect);
  }

  private async unwrap<T>(res: APIResponse, what: string, expect?: number): Promise<T> {
    const text = await res.text();
    if (expect !== undefined ? res.status() !== expect : !res.ok()) {
      throw new Error(`${this.persona}: ${what} = ${res.status()} ${text}`);
    }
    if (!text) return undefined as T;
    const json = JSON.parse(text) as { data?: T };
    return json.data as T;
  }
}
