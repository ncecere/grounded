import type { z } from "zod";
import type { Database } from "@grounded/db";
import {
  agents,
  agentKbs,
  agentWidgetConfigs,
  retrievalConfigs,
  widgetTokens,
  chatEndpointTokens,
  knowledgeBases,
  tenantQuotas,
  modelConfigurations,
  modelProviders,
} from "@grounded/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { generateId } from "@grounded/shared";
import { log } from "@grounded/logger";
import {
  BadRequestError,
  NotFoundError,
  QuotaExceededError,
} from "../../middleware/error-handler";
import { loadAgentForTenant } from "../../services/agent-helpers";
import { getPublicTokenPrefix, hashPublicToken } from "../../services/public-token-security";
import {
  createAgentSchema,
  updateAgentSchema,
  updateKbsSchema,
  updateRetrievalConfigSchema,
  updateWidgetConfigSchema,
  createChatEndpointSchema,
  createWidgetTokenSchema,
} from "./schema";

type CreateAgentInput = z.infer<typeof createAgentSchema>;
type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
type UpdateKbsInput = z.infer<typeof updateKbsSchema>;
type UpdateRetrievalConfigInput = z.infer<typeof updateRetrievalConfigSchema>;
type UpdateWidgetConfigInput = z.infer<typeof updateWidgetConfigSchema>;
type CreateChatEndpointInput = z.infer<typeof createChatEndpointSchema>;
type CreateWidgetTokenInput = z.infer<typeof createWidgetTokenSchema>;

type WidgetTheme = Record<string, unknown>;
type AgentWidgetConfigInsert = typeof agentWidgetConfigs.$inferInsert;
type AgentWidgetConfigUpdate = Partial<AgentWidgetConfigInsert> & { updatedAt: Date };
type WidgetThemeConfig = AgentWidgetConfigInsert["theme"];

interface TokenMetadata {
  id: string;
  name: string | null;
  tokenPreview: string;
  createdAt: Date;
}

interface OneTimeTokenSecret extends TokenMetadata {
  token: string;
}

function toTokenPreview(tokenPrefix: string | null): string {
  return tokenPrefix ? `${tokenPrefix}...` : "redacted";
}

async function issueWidgetToken(
  tx: Database,
  {
    tenantId,
    agentId,
    userId,
    name,
  }: {
    tenantId: string;
    agentId: string;
    userId: string;
    name: string;
  }
): Promise<OneTimeTokenSecret> {
  const token = `wt_${generateId().replace(/-/g, "")}`;
  const tokenPrefix = getPublicTokenPrefix(token);
  const [created] = await tx
    .insert(widgetTokens)
    .values({
      tenantId,
      agentId,
      tokenHash: hashPublicToken(token),
      tokenPrefix,
      name,
      createdBy: userId,
    })
    .returning();

  return {
    id: created.id,
    name: created.name ?? null,
    token,
    tokenPreview: toTokenPreview(created.tokenPrefix),
    createdAt: created.createdAt,
  };
}

async function issueChatEndpointToken(
  tx: Database,
  {
    tenantId,
    agentId,
    userId,
    name,
    endpointType,
  }: {
    tenantId: string;
    agentId: string;
    userId: string;
    name: string | undefined;
    endpointType: "api" | "hosted";
  }
): Promise<OneTimeTokenSecret & { endpointType: "api" | "hosted" }> {
  const prefix = endpointType === "hosted" ? "ch_" : "ce_";
  const token = `${prefix}${generateId().replace(/-/g, "")}`;
  const tokenPrefix = getPublicTokenPrefix(token);

  const [created] = await tx
    .insert(chatEndpointTokens)
    .values({
      tenantId,
      agentId,
      tokenHash: hashPublicToken(token),
      tokenPrefix,
      name,
      endpointType,
      createdBy: userId,
    })
    .returning();

  return {
    id: created.id,
    name: created.name ?? null,
    token,
    tokenPreview: toTokenPreview(created.tokenPrefix),
    endpointType: created.endpointType,
    createdAt: created.createdAt,
  };
}

export async function listModels(tx: Database) {
  return tx
    .select({
      id: modelConfigurations.id,
      modelId: modelConfigurations.modelId,
      displayName: modelConfigurations.displayName,
      providerName: modelProviders.displayName,
      isDefault: modelConfigurations.isDefault,
    })
    .from(modelConfigurations)
    .innerJoin(modelProviders, eq(modelProviders.id, modelConfigurations.providerId))
    .where(
      and(
        eq(modelConfigurations.modelType, "chat"),
        eq(modelConfigurations.isEnabled, true),
        eq(modelProviders.isEnabled, true)
      )
    )
    .orderBy(modelConfigurations.isDefault, modelConfigurations.displayName);
}

export async function listAgentsWithKbs(tx: Database, tenantId: string) {
  const agentsList = await tx.query.agents.findMany({
    where: and(eq(agents.tenantId, tenantId), isNull(agents.deletedAt)),
  });

  return Promise.all(
    agentsList.map(async (agent) => {
      const kbs = await tx
        .select({ kbId: agentKbs.kbId })
        .from(agentKbs)
        .where(and(eq(agentKbs.agentId, agent.id), isNull(agentKbs.deletedAt)));
      return {
        ...agent,
        kbIds: kbs.map((kb) => kb.kbId),
      };
    })
  );
}

export async function createAgent(
  tx: Database,
  {
    tenantId,
    userId,
    body,
  }: {
    tenantId: string;
    userId: string;
    body: CreateAgentInput;
  }
) {
  const quotas = await tx.query.tenantQuotas.findFirst({
    where: eq(tenantQuotas.tenantId, tenantId),
  });

  const agentCount = await tx
    .select({ count: sql<number>`count(*)` })
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), isNull(agents.deletedAt)));

  if (quotas && agentCount[0].count >= quotas.maxAgents) {
    throw new QuotaExceededError("agents");
  }

  const [newAgent] = await tx
    .insert(agents)
    .values({
      tenantId,
      name: body.name,
      systemPrompt: body.systemPrompt,
      rerankerEnabled: body.rerankerEnabled,
      citationsEnabled: body.citationsEnabled,
      ragType: body.ragType,
      llmModelConfigId: body.llmModelConfigId,
      createdBy: userId,
    })
    .returning();

  await tx.insert(retrievalConfigs).values({
    agentId: newAgent.id,
  });

  await tx.insert(agentWidgetConfigs).values({
    agentId: newAgent.id,
  });

  await issueWidgetToken(tx, {
    tenantId,
    agentId: newAgent.id,
    userId,
    name: "Default",
  });

  if (body.kbIds && body.kbIds.length > 0) {
    await attachKbs(tx, tenantId, newAgent.id, body.kbIds);
  }

  return { agent: newAgent, kbIds: body.kbIds || [] };
}

export async function getAgentDetails(
  tx: Database,
  { agentId, tenantId }: { agentId: string; tenantId: string }
) {
  const { agent } = await loadAgentForTenant(tx, agentId, tenantId);

  const attachedKbs = await tx
    .select({ kbId: agentKbs.kbId, name: knowledgeBases.name })
    .from(agentKbs)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, agentKbs.kbId))
    .where(and(eq(agentKbs.agentId, agentId), isNull(agentKbs.deletedAt)));

  return { agent, attachedKbs };
}

export async function updateAgent(
  tx: Database,
  {
    agentId,
    tenantId,
    body,
  }: {
    agentId: string;
    tenantId: string;
    body: UpdateAgentInput;
  }
) {
  const { kbIds, ...agentData } = body;

  const [updatedAgent] = await tx
    .update(agents)
    .set(agentData)
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId), isNull(agents.deletedAt)))
    .returning();

  if (!updatedAgent) {
    throw new NotFoundError("Agent");
  }

  if (kbIds !== undefined) {
    await tx
      .update(agentKbs)
      .set({ deletedAt: new Date() })
      .where(and(eq(agentKbs.agentId, agentId), isNull(agentKbs.deletedAt)));

    if (kbIds.length > 0) {
      await attachKbs(tx, tenantId, agentId, kbIds);
    }
  }

  return updatedAgent;
}

export async function deleteAgent(
  tx: Database,
  { agentId, tenantId }: { agentId: string; tenantId: string }
) {
  const [deletedAgent] = await tx
    .update(agents)
    .set({ deletedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId), isNull(agents.deletedAt)))
    .returning();

  if (!deletedAgent) {
    throw new NotFoundError("Agent");
  }

  return deletedAgent;
}

export async function getAgentKbs(
  tx: Database,
  { agentId, tenantId }: { agentId: string; tenantId: string }
) {
  await loadAgentForTenant(tx, agentId, tenantId);

  return tx
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      description: knowledgeBases.description,
      isGlobal: knowledgeBases.isGlobal,
    })
    .from(agentKbs)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, agentKbs.kbId))
    .where(and(eq(agentKbs.agentId, agentId), isNull(agentKbs.deletedAt)));
}

export async function updateAgentKbs(
  tx: Database,
  {
    agentId,
    tenantId,
    body,
  }: {
    agentId: string;
    tenantId: string;
    body: UpdateKbsInput;
  }
) {
  await loadAgentForTenant(tx, agentId, tenantId);

  await tx
    .update(agentKbs)
    .set({ deletedAt: new Date() })
    .where(and(eq(agentKbs.agentId, agentId), isNull(agentKbs.deletedAt)));

  if (body.kbIds.length > 0) {
    await attachKbs(tx, tenantId, agentId, body.kbIds);
  }
}

export async function getRetrievalConfig(
  tx: Database,
  { agentId, tenantId }: { agentId: string; tenantId: string }
) {
  await loadAgentForTenant(tx, agentId, tenantId);

  return tx.query.retrievalConfigs.findFirst({
    where: eq(retrievalConfigs.agentId, agentId),
  });
}

export async function updateRetrievalConfig(
  tx: Database,
  {
    agentId,
    tenantId,
    body,
  }: {
    agentId: string;
    tenantId: string;
    body: UpdateRetrievalConfigInput;
  }
) {
  await loadAgentForTenant(tx, agentId, tenantId);

  const [updatedConfig] = await tx
    .update(retrievalConfigs)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(retrievalConfigs.agentId, agentId))
    .returning();

  return updatedConfig;
}

export async function getWidgetConfig(
  tx: Database,
  {
    agentId,
    tenantId,
    userId,
  }: {
    agentId: string;
    tenantId: string;
    userId: string;
  }
) {
  await loadAgentForTenant(tx, agentId, tenantId);

  const config = await tx.query.agentWidgetConfigs.findFirst({
    where: eq(agentWidgetConfigs.agentId, agentId),
  });

  const existingTokens = await tx.query.widgetTokens.findMany({
    where: and(eq(widgetTokens.agentId, agentId), isNull(widgetTokens.revokedAt)),
  });

  const tokens: TokenMetadata[] = existingTokens.map((token) => ({
    id: token.id,
    name: token.name ?? null,
    tokenPreview: toTokenPreview(token.tokenPrefix),
    createdAt: token.createdAt,
  }));

  let issuedToken: OneTimeTokenSecret | null = null;
  if (tokens.length === 0) {
    issuedToken = await issueWidgetToken(tx, {
      tenantId,
      agentId,
      userId,
      name: "Default",
    });
    tokens.push({
      id: issuedToken.id,
      name: issuedToken.name,
      tokenPreview: issuedToken.tokenPreview,
      createdAt: issuedToken.createdAt,
    });
  }

  return {
    config,
    tokens,
    issuedToken: issuedToken
      ? {
          token: issuedToken.token,
          tokenPreview: issuedToken.tokenPreview,
        }
      : null,
  };
}

export function buildWidgetConfigUpdate(
  body: UpdateWidgetConfigInput,
  existingTheme?: WidgetTheme | null
) {
  const updateData: AgentWidgetConfigUpdate = {
    updatedAt: new Date(),
  };

  if (body.isPublic !== undefined) updateData.isPublic = body.isPublic;
  if (body.allowedDomains) updateData.allowedDomains = body.allowedDomains;
  if (body.oidcRequired !== undefined) updateData.oidcRequired = body.oidcRequired;

  if (body.theme && existingTheme) {
    updateData.theme = {
      ...existingTheme,
      ...body.theme,
    } as WidgetThemeConfig;
  }

  return updateData;
}

export async function updateWidgetConfig(
  tx: Database,
  {
    agentId,
    tenantId,
    body,
  }: {
    agentId: string;
    tenantId: string;
    body: UpdateWidgetConfigInput;
  }
) {
  await loadAgentForTenant(tx, agentId, tenantId);

  const existing = await tx.query.agentWidgetConfigs.findFirst({
    where: eq(agentWidgetConfigs.agentId, agentId),
  });

  if (body.theme && existing) {
    log.debug("api", "Widget config theme update", {
      receivedTheme: body.theme,
      existingTheme: existing.theme,
    });
  }

  const updateData = buildWidgetConfigUpdate(body, existing?.theme);

  if (body.theme && existing) {
    log.debug("api", "Widget config merged theme", {
      mergedTheme: updateData.theme,
    });
  }

  const [updatedConfig] = await tx
    .update(agentWidgetConfigs)
    .set(updateData)
    .where(eq(agentWidgetConfigs.agentId, agentId))
    .returning();

  return updatedConfig;
}

export async function getWidgetToken(
  tx: Database,
  {
    agentId,
    tenantId,
    userId,
  }: {
    agentId: string;
    tenantId: string;
    userId: string;
  }
) {
  await loadAgentForTenant(tx, agentId, tenantId);

  const existingToken = await tx.query.widgetTokens.findFirst({
    where: and(eq(widgetTokens.agentId, agentId), isNull(widgetTokens.revokedAt)),
  });

  if (existingToken) {
    throw new BadRequestError(
      "Widget tokens are stored hashed and cannot be retrieved. Create a new token instead."
    );
  }

  const issuedToken = await issueWidgetToken(tx, {
    tenantId,
    agentId,
    userId,
    name: "Default",
  });

  return issuedToken.token;
}

export async function createWidgetToken(
  tx: Database,
  {
    agentId,
    tenantId,
    userId,
    body,
  }: {
    agentId: string;
    tenantId: string;
    userId: string;
    body: CreateWidgetTokenInput;
  }
) {
  await loadAgentForTenant(tx, agentId, tenantId);

  return issueWidgetToken(tx, {
    tenantId,
    agentId,
    userId,
    name: body.name || "Widget token",
  });
}

export async function revokeWidgetToken(
  tx: Database,
  {
    tokenId,
    agentId,
    tenantId,
  }: {
    tokenId: string;
    agentId: string;
    tenantId: string;
  }
) {
  const [revokedToken] = await tx
    .update(widgetTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(widgetTokens.id, tokenId),
        eq(widgetTokens.agentId, agentId),
        eq(widgetTokens.tenantId, tenantId),
        isNull(widgetTokens.revokedAt)
      )
    )
    .returning();

  if (!revokedToken) {
    throw new NotFoundError("Widget token");
  }

  return revokedToken;
}

export async function listChatEndpoints(
  tx: Database,
  { agentId, tenantId }: { agentId: string; tenantId: string }
) {
  await loadAgentForTenant(tx, agentId, tenantId);

  const endpoints = await tx.query.chatEndpointTokens.findMany({
    where: and(eq(chatEndpointTokens.agentId, agentId), isNull(chatEndpointTokens.revokedAt)),
  });

  return endpoints.map((endpoint) => ({
    id: endpoint.id,
    name: endpoint.name ?? null,
    tokenPreview: toTokenPreview(endpoint.tokenPrefix),
    endpointType: endpoint.endpointType,
    createdAt: endpoint.createdAt,
  }));
}

export async function createChatEndpoint(
  tx: Database,
  {
    agentId,
    tenantId,
    userId,
    body,
  }: {
    agentId: string;
    tenantId: string;
    userId: string;
    body: CreateChatEndpointInput;
  }
) {
  await loadAgentForTenant(tx, agentId, tenantId);

  return issueChatEndpointToken(tx, {
    tenantId,
    agentId,
    userId,
    name: body.name,
    endpointType: body.endpointType,
  });
}

export async function revokeChatEndpoint(
  tx: Database,
  {
    endpointId,
    agentId,
    tenantId,
  }: {
    endpointId: string;
    agentId: string;
    tenantId: string;
  }
) {
  const [revokedEndpoint] = await tx
    .update(chatEndpointTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(chatEndpointTokens.id, endpointId),
        eq(chatEndpointTokens.agentId, agentId),
        eq(chatEndpointTokens.tenantId, tenantId),
        isNull(chatEndpointTokens.revokedAt)
      )
    )
    .returning();

  if (!revokedEndpoint) {
    throw new NotFoundError("Chat endpoint");
  }

  return revokedEndpoint;
}

async function attachKbs(
  tx: Database,
  tenantId: string,
  agentId: string,
  kbIds: string[]
) {
  const accessibleKbs = await tx.query.knowledgeBases.findMany({
    where: and(inArray(knowledgeBases.id, kbIds), isNull(knowledgeBases.deletedAt)),
  });

  const accessibleKbIds = new Set(
    accessibleKbs
      .filter((kb) => kb.tenantId === tenantId || (kb.isGlobal && kb.publishedAt))
      .map((kb) => kb.id)
  );

  const validKbIds = kbIds.filter((id) => accessibleKbIds.has(id));

  if (validKbIds.length > 0) {
    await tx.insert(agentKbs).values(
      validKbIds.map((kbId) => ({
        agentId,
        kbId,
      }))
    );
  }
}
