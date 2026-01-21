import { describe, expect, it } from "bun:test";
import { extractContent } from "./extraction";

describe("extractContent", () => {
  it("removes non-content elements and extracts text", () => {
    const html = `
      <html>
        <head><style>.hidden { display: none; }</style></head>
        <body>
          <header>Header</header>
          <nav>Nav</nav>
          <h1>Title</h1>
          <p>Hello <strong>world</strong></p>
          <h2>Section <em>A</em></h2>
          <script>console.log("ignore")</script>
          <footer>Footer</footer>
        </body>
      </html>
    `;

    const result = extractContent(html);

    expect(result.mainContent).toBe("Title Hello world Section A");
    expect(result.headings).toHaveLength(2);
    expect(result.headings[0]).toMatchObject({ level: 1, text: "Title" });
    expect(result.headings[1]).toMatchObject({ level: 2, text: "Section A" });
  });

  it("builds hierarchical heading paths", () => {
    const html = `
      <body>
        <h1>Docs</h1>
        <h2>Intro</h2>
        <h3>Deep Dive</h3>
        <h2>Next</h2>
      </body>
    `;

    const result = extractContent(html);

    expect(result.headings.map((heading) => heading.path)).toEqual([
      "Docs",
      "Docs > Intro",
      "Docs > Intro > Deep Dive",
      "Docs > Next",
    ]);
  });
});
