import type { Schemas } from "../api/client";
import { desired, effectiveLimit, overrideChanges, overrideError, overrideForm, platformChanges, platformErrors, platformForm } from "../pages/admin/limits/form";

const platform = (p: Partial<Schemas["PlatformLimit"]>) => ({ key: "data_sources", unit: "count", period: "none", default: 10, ceiling: 100, ...p }) as Schemas["PlatformLimit"];
const override = (p: Partial<Schemas["TeamLimitOverride"]>) =>
  ({ key: "data_sources", unit: "count", period: "none", default: 10, ceiling: 100, override: null, effective: 10, ...p }) as Schemas["TeamLimitOverride"];

describe("platform limits form", () => {
  it("flags a default above the ceiling and unparseable values", () => {
    const it0 = platform({});
    expect(platformErrors(it0, { def: "200", ceil: "100" })).toEqual({ def: "The default can't be above the ceiling." });
    expect(platformErrors(it0, { def: "x", ceil: "" })).toEqual({ def: "Enter a whole number, or leave empty." });
    expect(platformErrors(it0, { def: "", ceil: "100" })).toEqual({ def: "The default can't be above the ceiling." });
  });

  it("only sends rows that changed and parse", () => {
    const items = [platform({ key: "data_sources" }), platform({ key: "knowledge_bases" })];
    const form = { ...platformForm(items), knowledge_bases: { def: "20", ceil: "100" } };
    expect(platformChanges(items, form)).toEqual([{ key: "knowledge_bases", default: 20, ceiling: 100 }]);
    expect(platformChanges(items, null)).toEqual([]);
  });
});

describe("team overrides form", () => {
  it("maps overrides to inherit, blocked and custom rows", () => {
    const form = overrideForm([override({ key: "data_sources", override: null }), override({ key: "knowledge_bases", override: 0 }), override({ key: "agents", override: 5 })]);
    expect(form).toEqual({
      data_sources: { mode: "inherit", value: "" },
      knowledge_bases: { mode: "blocked", value: "" },
      agents: { mode: "custom", value: "5" },
    });
  });

  it("treats a custom 0 or empty value as invalid", () => {
    expect(desired(override({}), { mode: "custom", value: "0" })).toBeUndefined();
    expect(overrideError(override({}), { mode: "custom", value: "" })).toBe("Enter a whole number above 0.");
    expect(overrideError(override({}), { mode: "custom", value: "500" })).toMatch(/^The platform ceiling is /);
  });

  it("caps the effective value by the ceiling and lists changes", () => {
    const it0 = override({ ceiling: 50 });
    expect(effectiveLimit(it0, { mode: "custom", value: "80" })).toBe(50);
    expect(effectiveLimit(it0, { mode: "inherit", value: "" })).toBe(10);
    expect(effectiveLimit(it0, { mode: "custom", value: "x" })).toBe(10);
    expect(overrideChanges([it0], { data_sources: { mode: "blocked", value: "" } })).toEqual([{ key: "data_sources", value: 0 }]);
  });
});
