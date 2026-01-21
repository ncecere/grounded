import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  ContentError,
  ErrorCode,
  HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR,
} from "@grounded/shared";
import { fetchWithHttp } from "./http";

const originalEnv = process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR];

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR];
  } else {
    process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR] = originalEnv;
  }
});

describe("fetchWithHttp", () => {
  it("fetches HTML content and extracts title", async () => {
    const html = "<html><title>Example</title><body>Hello</body></html>";
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );

    const result = await fetchWithHttp("https://example.com");

    expect(result).toEqual({ html, title: "Example" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });

  it("rejects unsupported content types when enforcement is enabled", async () => {
    delete process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR];

    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("%PDF-1.7", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      })
    );

    let error: unknown;

    try {
      await fetchWithHttp("https://example.com/file.pdf");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ContentError);
    expect((error as ContentError).code).toBe(ErrorCode.CONTENT_UNSUPPORTED_TYPE);

    fetchSpy.mockRestore();
  });
});
