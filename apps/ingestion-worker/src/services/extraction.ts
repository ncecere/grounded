export interface Heading {
  level: number;
  text: string;
  position: number;
  path: string;
}

export function extractContent(html: string): { mainContent: string; headings: Heading[] } {
  // Simple content extraction - in production use readability.js or similar

  // Remove scripts and styles
  let content = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "");

  // Extract headings
  const headings: Heading[] = [];
  const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi;
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    const level = Number.parseInt(match[1], 10);
    const text = match[2].replace(/<[^>]+>/g, "").trim();
    if (text) {
      headings.push({
        level,
        text,
        position: match.index,
        path: buildHeadingPath(headings, level, text),
      });
    }
  }

  // Convert to text
  const mainContent = content
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { mainContent, headings };
}

export function buildHeadingPath(
  existingHeadings: Heading[],
  level: number,
  text: string
): string {
  const pathParts: string[] = [];

  // Find parent headings
  for (let i = existingHeadings.length - 1; i >= 0; i--) {
    const heading = existingHeadings[i];
    if (heading.level < level) {
      pathParts.unshift(heading.text);
      level = heading.level;
    }
  }

  pathParts.push(text);
  return pathParts.join(" > ");
}
