import { expect } from "@playwright/test";
import type { Api, Schemas } from "./api";
import { type Persona, emailOf } from "./env";

/*
 * Arranging state through the API, for what a spec isn't about. Specs run in
 * parallel, so each makes its own team with a unique slug.
 */

/** A unique slug: prefix plus a random suffix (letters and digits). */
export function unique(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A document whose first line the fake chat model quotes back as its answer,
 * with a citation mark ([1]).
 */
export const handbook = {
  name: "parking-handbook.md",
  body: "Student parking permits cost 120 dollars per semester and are sold at the transportation office in Lot 4.\n",
  answer: "Student parking permits cost 120 dollars per semester",
};

/**
 * Creates a team (as the platform admin) owned by the owner's persona; the
 * owner adds the other members.
 */
export async function createTeam(admin: Api, owner: Api, opts: { prefix: string; members?: Partial<Record<Persona, Schemas["TeamRole"]>> }) {
  const slug = unique(opts.prefix);
  await admin.post("/v1/admin/teams", { slug, name: `E2E ${slug}`, maxClassification: "sensitive", ownerEmail: emailOf(owner.persona) });
  await owner.refresh();
  for (const [who, role] of Object.entries(opts.members ?? {})) {
    await owner.post(`/v1/teams/${slug}/members`, { email: emailOf(who as Persona), role });
  }
  return slug;
}

/** The platform's E2E chat model (seed.setup.ts). */
export async function chatModel(api: Api) {
  const models = await api.get<Schemas["ChatModelOption"][]>("/v1/chat-models");
  const m = models.find((x) => x.displayName === "E2E chat");
  if (!m) throw new Error("the seed's chat model is missing");
  return m;
}

/** An upload source with the handbook (or docs) indexed, a KB over it, and a published agent. */
export async function publishedAgent(api: Api, team: string, opts: { name: string; audience?: Schemas["Audience"]; docs?: { name: string; body: string }[] }) {
  const base = `/v1/teams/${team}`;
  const docs = opts.docs ?? [handbook];
  const src = await api.post<Schemas["DataSource"]>(`${base}/sources`, { name: `${opts.name} files`, classification: "open" });
  await api.upload(team, src.id, docs);
  await expect
    .poll(async () => (await api.get<Schemas["DocumentPage"]>(`${base}/sources/${src.id}/documents`)).items.map((d) => d.status), { timeout: 30_000 })
    .toEqual(docs.map(() => "ready"));
  const kb = await api.post<Schemas["KnowledgeBase"]>(`${base}/kbs`, { name: `${opts.name} KB` });
  await api.put(`${base}/kbs/${kb.id}/sources/${src.id}`);
  const model = await chatModel(api);
  const agent = await api.post<Schemas["Agent"]>(`${base}/agents`, {
    name: opts.name,
    welcomeMessage: "Ask me about parking.",
    config: { chatModelId: model.id, kbs: [{ kbId: kb.id }], instructions: "Be brief.", audience: opts.audience ?? "team" },
  });
  await api.post(`${base}/agents/${agent.id}/publish`, { note: "E2E" }, { expect: 201 });
  return { source: src, kb, agent };
}
