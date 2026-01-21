import { describe, it, expect } from "bun:test";

import { createV1Routes } from "./index";

describe("createV1Routes", () => {
  it("mounts the auth callback route", async () => {
    const v1 = createV1Routes();
    const response = await v1.fetch(
      new Request("http://localhost/auth/oidc/callback?error=access_denied")
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: "access_denied" });
  });
});
