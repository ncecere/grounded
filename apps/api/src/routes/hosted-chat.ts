import { Hono } from "hono";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const hostedChatRoutes = new Hono();

// Cache the JS content in memory (loaded on first request)
let publishedChatJsCache: string | null = null;

// Redirect /chat/:token to /api/v1/c/:token for the hosted chat page
hostedChatRoutes.get("/chat/:token", (c) => {
  const token = c.req.param("token");
  // Forward to the chat endpoint route
  return c.redirect(`/api/v1/c/${token}`);
});

// Serve published-chat.js for hosted chat pages
hostedChatRoutes.get("/published-chat.js", (c) => {
  if (!publishedChatJsCache) {
    // Try multiple paths:
    // - Docker/production: /app/packages/widget/dist/published-chat.js
    // - Local dev from project root: packages/widget/dist/published-chat.js
    // - Local dev from apps/api: ../../packages/widget/dist/published-chat.js
    const paths = [
      join(process.cwd(), "packages/widget/dist/published-chat.js"),
      join(process.cwd(), "../../packages/widget/dist/published-chat.js"),
    ];

    for (const path of paths) {
      if (existsSync(path)) {
        publishedChatJsCache = readFileSync(path, "utf-8");
        break;
      }
    }

    if (!publishedChatJsCache) {
      return c.text("// Published chat JS not found", 404);
    }
  }

  c.header("Content-Type", "application/javascript");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(publishedChatJsCache);
});
