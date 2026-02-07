import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@grounded/shared";

const TOKEN_HASH_ALGO = "sha256";
const TOKEN_HASH_VERSION = "v1";
const TOKEN_PREFIX_LENGTH = 12;

let cachedSecret: string | null = null;

function getTokenHashSecret(): string {
  if (cachedSecret) {
    return cachedSecret;
  }

  const configured = getEnv("PUBLIC_TOKEN_HMAC_SECRET", "");
  const fallback = process.env.SESSION_SECRET || "grounded-dev-public-token-secret";
  cachedSecret = configured || fallback;
  return cachedSecret;
}

export function getPublicTokenPrefix(rawToken: string): string {
  return rawToken.slice(0, TOKEN_PREFIX_LENGTH);
}

export function hashPublicToken(rawToken: string): string {
  const digest = createHmac(TOKEN_HASH_ALGO, getTokenHashSecret())
    .update(rawToken, "utf8")
    .digest("hex");
  return `${TOKEN_HASH_VERSION}:${digest}`;
}

export function safeTokenEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");

  if (aBuf.length !== bBuf.length) {
    return false;
  }

  return timingSafeEqual(aBuf, bBuf);
}

export function maskToken(tokenPrefix: string | null): string {
  if (tokenPrefix) {
    return `${tokenPrefix}...`;
  }
  return "redacted";
}
