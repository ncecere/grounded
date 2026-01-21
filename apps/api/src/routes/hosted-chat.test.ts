import { describe, expect, it } from "bun:test";

import { hostedChatRoutes } from "./hosted-chat";

describe("hostedChatRoutes", () => {
  it("redirects /chat/:token to the chat endpoint", async () => {
    const response = await hostedChatRoutes.fetch(new Request("http://localhost/chat/token-123"));

    expect([301, 302]).toContain(response.status);
    expect(response.headers.get("location")).toBe("/api/v1/c/token-123");
  });

  it("serves published chat JS or returns 404", async () => {
    const response = await hostedChatRoutes.fetch(new Request("http://localhost/published-chat.js"));

    expect([200, 404]).toContain(response.status);
    if (response.status === 200) {
      expect(response.headers.get("Content-Type")).toContain("application/javascript");
    } else {
      const body = await response.text();
      expect(body).toContain("Published chat JS not found");
    }
  });
});
