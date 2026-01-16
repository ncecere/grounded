import { generateText } from "ai";
import { getAIRegistry } from "@grounded/ai-providers";
import { retry } from "@grounded/shared";

// ============================================================================
// Types
// ============================================================================

export interface EnrichmentResult {
  summary: string;
  keywords: string[];
  tags: string[];
  entities: string[];
}

// ============================================================================
// Enrichment Functions
// ============================================================================

/**
 * Generate enrichment data for a document/page.
 * @param text - Document text to analyze
 * @param title - Optional document title
 * @param modelConfigId - Optional specific model to use (defaults to configured default)
 */
export async function generateEnrichment(
  text: string,
  title?: string,
  modelConfigId?: string
): Promise<EnrichmentResult> {
  const registry = getAIRegistry();
  const model = await registry.getLanguageModel(modelConfigId);

  if (!model) {
    throw new Error("No chat model configured. Please configure a chat model in AI Models.");
  }

  const prompt = `Analyze the following document and extract:
1. A brief summary (2-3 sentences)
2. 5-10 relevant keywords
3. 3-5 category tags (e.g., "documentation", "tutorial", "api-reference", "faq")
4. Named entities (products, technologies, people, companies mentioned)

Document Title: ${title || "Untitled"}

Document Content:
${text.slice(0, 8000)}

Respond in JSON format:
{
  "summary": "...",
  "keywords": ["..."],
  "tags": ["..."],
  "entities": ["..."]
}`;

  const result = await retry(
    async () => {
      const response = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        maxOutputTokens: 1024,
        temperature: 0.1,
      });

      // Parse JSON response
      const text = response.text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Failed to parse enrichment response as JSON");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || "",
        keywords: parsed.keywords || [],
        tags: parsed.tags || [],
        entities: parsed.entities || [],
      };
    },
    { maxAttempts: 3, initialDelayMs: 1000 }
  );

  return result;
}
