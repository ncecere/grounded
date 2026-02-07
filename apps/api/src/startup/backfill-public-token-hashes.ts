import { withSystemAdminContext } from "@grounded/db";
import { widgetTokens, chatEndpointTokens } from "@grounded/db/schema";
import { and, isNull, or, sql } from "drizzle-orm";
import { log } from "@grounded/logger";

async function countActiveWidgetTokensMissingHashMetadata(): Promise<number> {
  const [row] = await withSystemAdminContext((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(widgetTokens)
      .where(
        and(
          isNull(widgetTokens.revokedAt),
          or(isNull(widgetTokens.tokenHash), isNull(widgetTokens.tokenPrefix))
        )
      )
  );
  return row?.count ?? 0;
}

async function countActiveChatEndpointTokensMissingHashMetadata(): Promise<number> {
  const [row] = await withSystemAdminContext((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(chatEndpointTokens)
      .where(
        and(
          isNull(chatEndpointTokens.revokedAt),
          or(isNull(chatEndpointTokens.tokenHash), isNull(chatEndpointTokens.tokenPrefix))
        )
      )
  );
  return row?.count ?? 0;
}

export async function backfillPublicTokenHashes(): Promise<void> {
  const [widgetMissingCount, chatEndpointMissingCount] = await Promise.all([
    countActiveWidgetTokensMissingHashMetadata(),
    countActiveChatEndpointTokensMissingHashMetadata(),
  ]);

  if (widgetMissingCount > 0 || chatEndpointMissingCount > 0) {
    const details = {
      widgetTokensMissingHashMetadata: widgetMissingCount,
      chatEndpointTokensMissingHashMetadata: chatEndpointMissingCount,
    };

    log.error("api", "Public token hash metadata verification failed", details);
    throw new Error(
      "Active public tokens are missing token_hash/token_prefix metadata. Run data migration before startup."
    );
  }

  log.info("api", "Public token hash metadata verification passed", {
    widgetTokensMissingHashMetadata: widgetMissingCount,
    chatEndpointTokensMissingHashMetadata: chatEndpointMissingCount,
  });
}
