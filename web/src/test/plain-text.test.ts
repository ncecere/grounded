import { markdownToText } from "../lib/plain-text";

describe("markdownToText", () => {
  it("keeps the text of emphasis, links, images, code and headings", () => {
    expect(markdownToText("## Fees\n\nThe **2019** fee is in [the fee schedule](https://registrar.example.edu/fees_(2019)).")).toBe(
      "Fees\n\nThe 2019 fee is in the fee schedule.",
    );
    expect(markdownToText("![Campus map](/map.png) *Open* on `Monday` ~~never~~ __always__")).toBe("Campus map Open on Monday never always");
  });

  it("leaves lists, snake_case words and lone asterisks alone", () => {
    expect(markdownToText("- first_item\n- 2 * 3 = 6\n> quoted")).toBe("- first_item\n- 2 * 3 = 6\nquoted");
  });

  it("drops table and horizontal rules", () => {
    expect(markdownToText("| A | B |\n|---|---|\n| 1 | 2 |\n\n---\nEnd")).toBe("| A | B |\n\n| 1 | 2 |\n\nEnd");
  });
});
