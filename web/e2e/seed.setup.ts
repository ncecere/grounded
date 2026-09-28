import { test as setup } from "@playwright/test";
import { Api, type Schemas } from "./support/api";
import { authFile, fakeChatModel, fakeEmbedDims, fakeEmbedModel, fakeKey, fakeURL, personas } from "./support/env";

/*
 * Runs once before the specs (the "seed" project). Idempotent, so it also
 * works against a reused server (`bin/e2eserver` started by hand):
 * - every development persona signs in; its browser state is saved for specs;
 * - the platform gets the fake gateway: a connection, a chat model, an
 *   embedding model and the default embedding profile, and a moderation
 *   classifier with a public-audience policy, so agents can be published to
 *   the public (the public page and widget specs);
 * - public access is on.
 * Everything else belongs to the spec that needs it, in its own team.
 */

setup("sign in every persona", async () => {
  for (const p of personas) {
    const api = await Api.signIn(p);
    await api.ctx.storageState({ path: authFile(p) });
    await api.dispose();
  }
});

setup("platform models, moderation and public access", async () => {
  const admin = await Api.signIn("admin");

  const conns = await admin.get<Schemas["Connection"][]>("/v1/admin/connections");
  const conn =
    conns.find((c) => c.name === "E2E fake models") ??
    (await admin.post<Schemas["Connection"]>("/v1/admin/connections", { name: "E2E fake models", baseUrl: fakeURL, apiKey: fakeKey }));

  const models = await admin.get<Schemas["Model"][]>("/v1/admin/models");
  const model = async (key: string, body: Record<string, unknown>) =>
    models.find((m) => m.key === key) ??
    (await admin.post<Schemas["Model"]>("/v1/admin/models", { connectionId: conn.id, key, maxClassification: "restricted", ...body }));
  await model("e2e-chat", {
    upstreamModel: fakeChatModel,
    displayName: "E2E chat",
    kind: "chat",
    contextWindow: 32000,
    maxOutputTokens: 2048,
    supportsTools: true,
  });
  const embed = await model("e2e-embed", { upstreamModel: fakeEmbedModel, displayName: "E2E embeddings", kind: "embedding", dimensions: fakeEmbedDims });
  const classifier = await model("e2e-moderation", {
    upstreamModel: fakeChatModel,
    displayName: "E2E moderation",
    kind: "moderation",
    moderationProvider: "chat_classifier",
  });

  const profiles = await admin.get<Schemas["EmbeddingProfile"][]>("/v1/admin/embedding-profiles");
  if (!profiles.some((p) => p.key === "e2e")) {
    await admin.post("/v1/admin/embedding-profiles", {
      key: "e2e",
      name: "E2E profile",
      modelId: embed.id,
      chunkSize: 256,
      chunkOverlap: 0,
      isDefault: true,
    });
  }

  const rule = { action: "block", threshold: 0.5 };
  await admin.putRevised("/v1/admin/moderation/policies/public", {
    modelId: classifier.id,
    outputMode: "buffer",
    failClosed: true,
    categories: { violence: { input: rule, output: rule } },
  });
  await admin.putRevised("/v1/admin/settings/public-access", { publicAgentsEnabled: true });
  await admin.dispose();
});
