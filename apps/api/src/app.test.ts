import { describe, it, expect } from "bun:test";

import { createApiApp } from "./app";

describe("createApiApp", () => {
  it("serves the health check with request id", async () => {
    const app = createApiApp();
    const response = await app.fetch(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const body = (await response.json()) as { status: string; version: string };
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
  });
});
