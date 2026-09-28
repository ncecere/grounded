import { slugify } from "../pages/admin/people/common";

describe("slugify", () => {
  it("lowercases and joins words with single hyphens", () => {
    expect(slugify("Office of the Registrar")).toBe("office-of-the-registrar");
    expect(slugify("  R&D -- Lab!  ")).toBe("r-d-lab");
  });

  it("caps the slug at 63 characters", () => {
    expect(slugify("a".repeat(80))).toHaveLength(63);
  });
});
