/* The delete dialog's wording for one document or several, and for a website's pages (v0.4.0 walkthrough own-15). */
import { deleteWording } from "../pages/team/documents/mutations";

describe("delete wording", () => {
  it("uses the singular for one document and the plural for several", () => {
    expect(deleteWording(1, false)).toEqual({
      description: "The document and its passages are removed from this source and every knowledge base that uses it.",
      confirm: "Delete document",
    });
    expect(deleteWording(3, false)).toEqual({
      description: "The documents and their passages are removed from this source and every knowledge base that uses it.",
      confirm: "Delete documents",
    });
  });

  it("says pages for a website, and that the next crawl adds them again", () => {
    expect(deleteWording(1, true).description).toBe(
      "The page and its passages are removed from this source and every knowledge base that uses it. The next crawl adds it again if it's still on the site.",
    );
    expect(deleteWording(2, true)).toEqual({
      description:
        "The pages and their passages are removed from this source and every knowledge base that uses it. The next crawl adds them again if they're still on the site.",
      confirm: "Delete pages",
    });
  });
});
