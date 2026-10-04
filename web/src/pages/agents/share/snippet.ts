/* The widget's embed snippet and origin hints (docs/phase4-publishing.md §6). Pure: tested in src/test/share.test.ts. */

export type WidgetPosition = "bottom-right" | "bottom-left";

type SnippetInput = {
  scriptUrl: string;
  agentId: string;
  /** The full publishable key, or a placeholder when it isn't known here. */
  key: string;
  /** Subresource Integrity of widget.js ("" when unknown). */
  integrity?: string;
  position?: WidgetPosition;
};

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The <script> tag a site adds to show the widget. */
export function embedSnippet({ scriptUrl, agentId, key, integrity, position = "bottom-right" }: SnippetInput): string {
  const parts = [`src="${attr(scriptUrl)}"`, `data-agent="${attr(agentId)}"`, `data-key="${attr(key)}"`];
  if (position !== "bottom-right") parts.push(`data-position="${position}"`);
  if (integrity) parts.push(`integrity="${attr(integrity)}"`, `crossorigin="anonymous"`);
  parts.push("async");
  return `<script ${parts.join(" ")}></script>`;
}

/** A quick client-side check of an allowed origin (the API has the final word). */
export function originProblem(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (v === "*" || /^https?:\/\/\*$/i.test(v)) return `${v}: a lone * would allow every site; list each site, or use *.example.edu for a domain's subdomains`;
  const withScheme = /^[a-z]+:\/\//i.test(v) ? v : `${/^(localhost|127\.|\[::1\])/i.test(v) ? "http" : "https"}://${v}`;
  let u: URL;
  try {
    u = new URL(withScheme.replace("://*.", "://wildcard."));
  } catch {
    return `${v}: not an origin`;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return `${v}: use http or https`;
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return `${v}: no path, query or fragment`;
  if (v.includes("*") && !/^(https?:\/\/)?\*\.[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(v)) return `${v}: a wildcard looks like *.example.edu`;
  return undefined;
}
