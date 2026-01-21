import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";

let fetchWithFirecrawl: (url: string) => Promise<{ html: string; title: string | null }>;
const originalApiKey = process.env.FIRECRAWL_API_KEY;

beforeAll(async () => {
  process.env.FIRECRAWL_API_KEY = "test-key";
  ({ fetchWithFirecrawl } = await import("./firecrawl"));
});

afterAll(() => {
  if (originalApiKey === undefined) {
    delete process.env.FIRECRAWL_API_KEY;
  } else {
    process.env.FIRECRAWL_API_KEY = originalApiKey;
  }
});

describe("fetchWithFirecrawl", () => {
  it("returns HTML and title from Firecrawl response", async () => {
    const responseBody = JSON.stringify({
      data: { html: "<html>Firecrawl</html>", metadata: { title: "Firecrawl" } },
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(responseBody, { status: 200 })
    );

    const result = await fetchWithFirecrawl("https://example.com");

    expect(result).toEqual({ html: "<html>Firecrawl</html>", title: "Firecrawl" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });
});
