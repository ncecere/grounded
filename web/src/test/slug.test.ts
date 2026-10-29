import { slugFromName } from "../lib/slug";

describe("slugFromName", () => {
  it("lowercases and joins words with single hyphens", () => {
    expect(slugFromName("Office of the Registrar")).toBe("office-of-the-registrar");
    expect(slugFromName("  R&D -- Lab!  ")).toBe("r-d-lab");
  });

  it("caps the slug at the limit without a trailing hyphen", () => {
    expect(slugFromName("a".repeat(80))).toHaveLength(63);
    expect(slugFromName("ab ".repeat(40), 30)).toMatch(/^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/);
  });

  // #132: accented and non-Latin letters used to be dropped ("Ünï" → "n").
  it("keeps accented letters and romanises Cyrillic and Greek", () => {
    expect(slugFromName("Ünï")).toBe("uni");
    expect(slugFromName("Über café 2")).toBe("uber-cafe-2");
    expect(slugFromName("Straße Ærø Łódź")).toBe("strasse-aero-lodz");
    expect(slugFromName("Привет, мир")).toBe("privet-mir");
    expect(slugFromName("Юрий Щукин")).toBe("yurii-shchukin");
    expect(slugFromName("Ελληνικά")).toBe("ellinika");
    expect(slugFromName("qa-build-日本語 ünï 😀")).toBe("qa-build-uni");
  });

  it("never gives one letter, an empty-looking address, a reserved word or an ID", () => {
    for (const name of ["日本語", "Ä", "😀 x 😀", "", "Admin", "123e4567-e89b-12d3-a456-426614174000"]) expect(slugFromName(name)).toBe("");
  });
});
