/*
 * Markdown as plain text, for short previews (a document's passages in its
 * sheet): the reader sees "2019" and "the fee schedule", not "**2019**" and
 * "[the fee schedule](https://…)". Line breaks and list markers stay; this
 * isn't a renderer, just enough to read the text.
 */
export function markdownToText(md: string): string {
  return (
    md
      // Images and links: keep the text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
      // Headings and block quotes at the start of a line.
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
      // Bold, italic, strikethrough and inline code.
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
      .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
      .replace(/`([^`\n]+)`/g, "$1")
      // Table rules and horizontal rules.
      .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-{0,}:?[ \t]*\|?[ \t]*$/gm, "")
      .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
