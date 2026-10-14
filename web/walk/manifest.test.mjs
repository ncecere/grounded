// The walk manifest: what is validated, how it expands into captures, and how a capture's checks become a verdict.
import { describe, expect, it } from "vitest";
import { DEFAULT_WIDTHS, PERSONAS, expand, isAllowed, pageOk, slug, summarize, validate } from "./manifest.mjs";

const manifest = {
  widths: [1440, 390],
  pages: [
    { persona: "admin", path: "/" },
    { persona: "admin", path: "/admin/models", wait: "table" },
    { persona: "user", path: "/settings/profile" },
  ],
};

describe("validate", () => {
  it("accepts a good manifest", () => expect(validate(manifest)).toEqual([]));

  it("names every problem, not just the first", () => {
    const problems = validate({ widths: [0, "wide"], pages: [{ persona: "nobody", path: "no-slash" }, { persona: "admin" }, { path: "/x" }] });
    expect(problems.join("\n")).toMatch(/width.*0/);
    expect(problems.join("\n")).toMatch(/width.*wide/);
    expect(problems.join("\n")).toMatch(/pages\[0\].*persona.*nobody/);
    expect(problems.join("\n")).toMatch(/pages\[0\].*path.*no-slash/);
    expect(problems.join("\n")).toMatch(/pages\[1\].*path/);
    expect(problems.join("\n")).toMatch(/pages\[2\].*persona/);
  });

  it("refuses a manifest with no pages, and anything that is not an object", () => {
    expect(validate({ pages: [] }).join()).toMatch(/at least one page/);
    expect(validate(null).join()).toMatch(/object/);
    expect(validate({}).join()).toMatch(/pages/);
  });

  it("flags a page listed twice for the same persona (one would overwrite the other)", () => {
    const problems = validate({ pages: [{ persona: "admin", path: "/" }, { persona: "user", path: "/" }, { persona: "admin", path: "/" }] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/pages\[2\].*admin \/ is listed twice/);
  });

  it("refuses a path that leaves the environment (an absolute URL)", () => {
    expect(validate({ pages: [{ persona: "admin", path: "https://example.org/" }] }).join()).toMatch(/path/);
    expect(validate({ pages: [{ persona: "admin", path: "//example.org/" }] }).join()).toMatch(/path/);
  });

  it("knows the six development personas", () => expect(PERSONAS).toEqual(["admin", "auditor", "user", "alex", "blair", "casey"]));
});

describe("expand", () => {
  it("makes one capture per page and width, in manifest order", () => {
    const got = expand(manifest);
    expect(got).toHaveLength(6);
    expect(got.map((c) => `${c.persona} ${c.path} ${c.width}`)).toEqual([
      "admin / 1440", "admin / 390", "admin /admin/models 1440", "admin /admin/models 390", "user /settings/profile 1440", "user /settings/profile 390",
    ]);
    expect(got[2].wait).toBe("table");
    expect(got[0].wait).toBeUndefined();
  });

  it("uses the default widths when the manifest names none", () => {
    expect(DEFAULT_WIDTHS).toEqual([1440, 1280, 390]);
    expect(expand({ pages: [{ persona: "admin", path: "/" }] }).map((c) => c.width)).toEqual(DEFAULT_WIDTHS);
  });

  it("narrows to the personas and widths asked for, and keeps order", () => {
    expect(expand(manifest, { personas: ["user"] }).map((c) => c.persona)).toEqual(["user", "user"]);
    expect(expand(manifest, { widths: [390] }).map((c) => c.width)).toEqual([390, 390, 390]);
  });

  it("gives every capture a distinct file name", () => {
    const got = expand({ widths: [1440, 1280, 390], pages: [{ persona: "admin", path: "/" }, { persona: "admin", path: "/a/b" }, { persona: "admin", path: "/a-b" }, { persona: "user", path: "/a/b" }] });
    const names = got.map((c) => c.file);
    expect(new Set(names).size).toBe(names.length); // "/a/b" and "/a-b" share a slug but not a file
    expect(got.find((c) => c.path === "/a-b").file).toBe("admin/a-b-2-1440.png");
    expect(got.find((c) => c.persona === "user").file).toBe("user/a-b-1440.png"); // another persona has its own directory
  });

  it("throws on an invalid manifest, saying why", () => expect(() => expand({ pages: [] })).toThrow(/at least one page/));
});

describe("slug and file names", () => {
  it("makes a readable file name from a path", () => {
    expect(slug("/")).toBe("home");
    expect(slug("/admin/models")).toBe("admin-models");
    expect(slug("/teams/demo/settings?tab=api-keys")).toBe("teams-demo-settings-tab-api-keys");
    expect(slug("/a/demo/go-docs")).toBe("a-demo-go-docs");
  });

  it("files a capture under its persona, with the width", () => {
    expect(expand({ widths: [1280], pages: [{ persona: "admin", path: "/admin/models" }] })[0].file).toBe("admin/admin-models-1280.png");
  });
});

describe("pageOk and summarize", () => {
  const clean = { persona: "admin", path: "/", width: 1440, axe: [], console: [], overflow: false, notFound: false };

  it("is ok only when every check is clean", () => {
    expect(pageOk(clean)).toBe(true);
    expect(pageOk({ ...clean, axe: [{ id: "color-contrast", impact: "serious", nodes: 2 }] })).toBe(false);
    expect(pageOk({ ...clean, console: ["boom"] })).toBe(false);
    expect(pageOk({ ...clean, overflow: true })).toBe(false);
    expect(pageOk({ ...clean, notFound: true })).toBe(false);
    expect(pageOk({ ...clean, error: "timeout" })).toBe(false);
  });

  it("counts, lists what failed and why, and is ok only if nothing failed", () => {
    const s = summarize([clean, { ...clean, path: "/admin", overflow: true }, { ...clean, path: "/x", axe: [{ id: "label", impact: "critical", nodes: 1 }], console: ["a", "b"] }]);
    expect(s.pages).toBe(3);
    expect(s.failed).toBe(2);
    expect(s.ok).toBe(false);
    expect(s.lines.join("\n")).toMatch(/admin \/admin 1440.*overflow/);
    expect(s.lines.join("\n")).toMatch(/admin \/x 1440.*axe label.*2 console error/);
    expect(summarize([clean]).ok).toBe(true);
    expect(summarize([]).ok).toBe(false); // a walk that captured nothing is not a pass
  });
});

describe("allowed console messages", () => {
  const allow = [{ match: "^404 GET /v1/teams/[^/]+/spend$", reason: "costs_off: the team's cost mode is off" }];

  it("validates the list: a pattern that compiles, and a reason for each", () => {
    expect(validate({ pages: [{ persona: "admin", path: "/" }], allow })).toEqual([]);
    expect(validate({ pages: [{ persona: "admin", path: "/" }], allow: [{ match: "(", reason: "x" }] }).join()).toMatch(/allow\[0\].*not a valid pattern/);
    expect(validate({ pages: [{ persona: "admin", path: "/" }], allow: [{ match: "x" }] }).join()).toMatch(/allow\[0\].*reason/);
    expect(validate({ pages: [{ persona: "admin", path: "/" }], allow: "nope" }).join()).toMatch(/allow must be a list/);
  });

  it("allows what matches the whole message and nothing else", () => {
    expect(isAllowed({ allow }, "404 GET /v1/teams/demo/spend")).toBe(true);
    expect(isAllowed({ allow }, "404 GET /v1/teams/demo/spend/extra")).toBe(false);
    expect(isAllowed({ allow }, "500 GET /v1/teams/demo/spend")).toBe(false);
    expect(isAllowed({ allow }, "uncaught: boom")).toBe(false);
    expect(isAllowed({}, "404 GET /v1/teams/demo/spend")).toBe(false);
  });
});
