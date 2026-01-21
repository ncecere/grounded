import { getEnv } from "@grounded/shared";

const FIRECRAWL_API_KEY = getEnv("FIRECRAWL_API_KEY", "");
const FIRECRAWL_API_URL = getEnv("FIRECRAWL_API_URL", "https://api.firecrawl.dev");

export async function fetchWithFirecrawl(
  url: string
): Promise<{ html: string; title: string | null }> {
  if (!FIRECRAWL_API_KEY) {
    throw new Error("Firecrawl API key not configured");
  }

  const response = await fetch(`${FIRECRAWL_API_URL}/v1/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ["html"],
      waitFor: 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firecrawl error: ${error}`);
  }

  const result = await response.json() as { data?: { html?: string; metadata?: { title?: string } } };

  return {
    html: result.data?.html || "",
    title: result.data?.metadata?.title || null,
  };
}
