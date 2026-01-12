import { createMiddleware } from "hono/factory";
import { checkRateLimit } from "@grounded/queue";
import { RateLimitError } from "./error-handler";

export const rateLimit = (options: {
  keyPrefix: string;
  limit: number;
  windowSeconds: number;
  keyFn?: (c: any) => string;
}) => {
  return createMiddleware(async (c, next) => {
    const auth = c.get("auth");

    // Build rate limit key
    let key: string;
    if (options.keyFn) {
      key = options.keyFn(c);
    } else if (auth?.tenantId) {
      key = `${options.keyPrefix}:${auth.tenantId}`;
    } else if (auth?.user?.id) {
      key = `${options.keyPrefix}:user:${auth.user.id}`;
    } else {
      // Use IP as fallback
      const ip = c.req.header("X-Forwarded-For")?.split(",")[0] || "unknown";
      key = `${options.keyPrefix}:ip:${ip}`;
    }

    const result = await checkRateLimit(key, options.limit, options.windowSeconds);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", options.limit.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000).toString());

    if (!result.allowed) {
      c.header("Retry-After", options.windowSeconds.toString());
      throw new RateLimitError(options.windowSeconds);
    }

    await next();
  });
};
