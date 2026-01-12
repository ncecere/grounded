import { db } from "@grounded/db";
import {
  tenants,
  knowledgeBases,
  sources,
  sourceRuns,
  sourceRunPages,
  kbChunks,
  agents,
  agentKbs,
  agentWidgetConfigs,
  retrievalConfigs,
  widgetTokens,
  deletionJobs,
  tenantMemberships,
  chatEvents,
  apiKeys,
  tenantQuotas,
  tenantUsage,
  tenantKbSubscriptions,
  uploads,
} from "@grounded/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getVectorStore } from "@grounded/vector-store";
import type { HardDeleteObjectJob } from "@grounded/shared";

export async function processHardDelete(data: HardDeleteObjectJob): Promise<void> {
  const { tenantId, objectType, objectId } = data;

  console.log(`Hard deleting ${objectType} ${objectId}`);

  // Update deletion job status
  await db
    .update(deletionJobs)
    .set({
      status: "running",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deletionJobs.objectType, objectType),
        eq(deletionJobs.objectId, objectId)
      )
    );

  try {
    switch (objectType) {
      case "kb":
        await deleteKnowledgeBase(tenantId, objectId);
        break;
      case "source":
        await deleteSource(tenantId, objectId);
        break;
      case "agent":
        await deleteAgent(tenantId, objectId);
        break;
      case "tenant":
        await deleteTenant(objectId);
        break;
      default:
        throw new Error(`Unknown object type: ${objectType}`);
    }

    // Update deletion job status
    await db
      .update(deletionJobs)
      .set({
        status: "succeeded",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(deletionJobs.objectType, objectType),
          eq(deletionJobs.objectId, objectId)
        )
      );

    console.log(`Successfully deleted ${objectType} ${objectId}`);
  } catch (error) {
    console.error(`Error deleting ${objectType} ${objectId}:`, error);

    await db
      .update(deletionJobs)
      .set({
        status: "failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(deletionJobs.objectType, objectType),
          eq(deletionJobs.objectId, objectId)
        )
      );

    throw error;
  }
}

async function deleteKnowledgeBase(tenantId: string, kbId: string): Promise<void> {
  // Get all sources for this KB
  const kbSources = await db.query.sources.findMany({
    where: eq(sources.kbId, kbId),
  });

  // Delete each source's data
  for (const source of kbSources) {
    await deleteSourceData(source.id);
  }

  // Delete sources
  await db.delete(sources).where(eq(sources.kbId, kbId));

  // Delete uploads
  await db.delete(uploads).where(eq(uploads.kbId, kbId));

  // Delete agent KB links
  await db.delete(agentKbs).where(eq(agentKbs.kbId, kbId));

  // Delete tenant KB subscriptions
  await db.delete(tenantKbSubscriptions).where(eq(tenantKbSubscriptions.kbId, kbId));

  // Delete the KB itself
  await db.delete(knowledgeBases).where(eq(knowledgeBases.id, kbId));
}

async function deleteSource(tenantId: string, sourceId: string): Promise<void> {
  await deleteSourceData(sourceId);
  await db.delete(sources).where(eq(sources.id, sourceId));
}

async function deleteSourceData(sourceId: string): Promise<void> {
  // Delete vectors from vector store by source
  const vectorStore = getVectorStore();
  if (vectorStore) {
    await vectorStore.deleteByMetadata({ sourceId });
  }

  // Get all chunks for this source (for cleanup)
  const sourceChunks = await db.query.kbChunks.findMany({
    where: eq(kbChunks.sourceId, sourceId),
  });

  const chunkIds = sourceChunks.map((c) => c.id);

  if (chunkIds.length > 0) {
    // Delete chunks from app DB
    await db.delete(kbChunks).where(inArray(kbChunks.id, chunkIds));
  }

  // Get all runs for this source
  const runs = await db.query.sourceRuns.findMany({
    where: eq(sourceRuns.sourceId, sourceId),
  });

  const runIds = runs.map((r) => r.id);

  if (runIds.length > 0) {
    // Delete run pages
    await db.delete(sourceRunPages).where(inArray(sourceRunPages.sourceRunId, runIds));

    // Delete runs
    await db.delete(sourceRuns).where(inArray(sourceRuns.id, runIds));
  }
}

async function deleteAgent(tenantId: string, agentId: string): Promise<void> {
  // Delete agent KBs
  await db.delete(agentKbs).where(eq(agentKbs.agentId, agentId));

  // Delete widget config
  await db.delete(agentWidgetConfigs).where(eq(agentWidgetConfigs.agentId, agentId));

  // Delete retrieval config
  await db.delete(retrievalConfigs).where(eq(retrievalConfigs.agentId, agentId));

  // Delete widget tokens
  await db.delete(widgetTokens).where(eq(widgetTokens.agentId, agentId));

  // Delete chat events (or keep for audit?)
  // await db.delete(chatEvents).where(eq(chatEvents.agentId, agentId));

  // Delete the agent
  await db.delete(agents).where(eq(agents.id, agentId));
}

async function deleteTenant(tenantId: string): Promise<void> {
  // Delete all vectors for this tenant in one operation
  const vectorStore = getVectorStore();
  if (vectorStore) {
    await vectorStore.deleteByMetadata({ tenantId });
  }

  // Get all KBs for this tenant
  const tenantKbs = await db.query.knowledgeBases.findMany({
    where: eq(knowledgeBases.tenantId, tenantId),
  });

  // Delete each KB (vectors already deleted above, but this cleans up other data)
  for (const kb of tenantKbs) {
    await deleteKnowledgeBase(tenantId, kb.id);
  }

  // Get all agents for this tenant
  const tenantAgents = await db.query.agents.findMany({
    where: eq(agents.tenantId, tenantId),
  });

  // Delete each agent
  for (const agent of tenantAgents) {
    await deleteAgent(tenantId, agent.id);
  }

  // Delete chat events
  await db.delete(chatEvents).where(eq(chatEvents.tenantId, tenantId));

  // Delete API keys
  await db.delete(apiKeys).where(eq(apiKeys.tenantId, tenantId));

  // Delete tenant quotas
  await db.delete(tenantQuotas).where(eq(tenantQuotas.tenantId, tenantId));

  // Delete tenant usage
  await db.delete(tenantUsage).where(eq(tenantUsage.tenantId, tenantId));

  // Delete tenant memberships
  await db.delete(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId));

  // Delete the tenant
  await db.delete(tenants).where(eq(tenants.id, tenantId));
}
