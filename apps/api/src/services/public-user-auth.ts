import { UnauthorizedError } from "../middleware/error-handler";
import { authenticateLocalJWT } from "../middleware/auth/bearer";
import { authenticateOIDC, isOIDCConfigured } from "../middleware/auth/oidc";

function extractBearerToken(authHeader: string | undefined): string {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("OIDC authentication required");
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new UnauthorizedError("OIDC authentication required");
  }

  return token;
}

function isMachineCredential(token: string): boolean {
  return token.startsWith("grounded_") || token.startsWith("grounded_admin_");
}

export async function verifyPublicUserBearerToken(
  authHeader: string | undefined,
  requiredTenantId?: string
): Promise<void> {
  const token = extractBearerToken(authHeader);

  if (isMachineCredential(token)) {
    throw new UnauthorizedError("A user bearer token is required");
  }

  try {
    await authenticateLocalJWT(token, requiredTenantId);
    return;
  } catch {
    if (!isOIDCConfigured()) {
      throw new UnauthorizedError("Invalid bearer token");
    }
  }

  try {
    await authenticateOIDC(token, requiredTenantId);
  } catch {
    throw new UnauthorizedError("Invalid bearer token");
  }
}
