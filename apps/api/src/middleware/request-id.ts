import { createMiddleware } from "hono/factory";
import { generateId } from "@grounded/shared";

export const requestId = () => {
  return createMiddleware(async (c, next) => {
    const id = c.req.header("X-Request-ID") || generateId();
    c.set("requestId", id);
    c.header("X-Request-ID", id);
    await next();
  });
};
