import { attachCandidates, attachOptions } from "../pages/team/kbs/attach";

const src = (id: string, embeddingProfileId = "p1", classification = "open") => ({ id, embeddingProfileId, classification });
const rank = (c: string) => ({ open: 0, sensitive: 1, restricted: 2 })[c];

describe("attachOptions", () => {
  it("splits unattached team sources by embedding profile", () => {
    const out = attachOptions({ attached: new Set(["a"]), embeddingProfileId: "p1", sources: [src("a"), src("b"), src("c", "p2")], shared: [], rank, teamMax: 1 });
    expect(out.compatible.map((x) => x.id)).toEqual(["b"]);
    expect(out.incompatible.map((x) => x.id)).toEqual(["c"]);
  });

  it("offers active shared sources with the same profile up to the team's classification, and counts the rest", () => {
    const shared = [
      { ...src("s1"), status: "active" },
      { ...src("s2", "p1", "restricted"), status: "active" },
      { ...src("s3", "p2"), status: "active" },
      { ...src("s4"), status: "disabled" },
      { ...src("s5", "p1", "unknown"), status: "active" },
    ];
    const out = attachOptions({ attached: new Set(), embeddingProfileId: "p1", sources: [], shared, rank, teamMax: 1 });
    expect(out.sharedCompatible.map((x) => x.id)).toEqual(["s1"]);
    expect(out.sharedHidden).toBe(3);
  });

  it("offers no shared sources when the team's level is unknown", () => {
    const out = attachOptions({ attached: new Set(), embeddingProfileId: "p1", sources: [], shared: [{ ...src("s1"), status: "active" }], rank, teamMax: undefined });
    expect(out.sharedCompatible).toEqual([]);
    expect(out.sharedHidden).toBe(1);
  });
});

describe("attachCandidates", () => {
  it("lists every unattached source with the reason it can't be attached", () => {
    const named = (id: string, profile = "p1", level = "open", status = "active") => ({ ...src(id, profile, level), name: id.toUpperCase(), status });
    const out = attachCandidates({
      attached: new Set(["a"]),
      embeddingProfileId: "p1",
      sources: [named("a"), named("c", "p2"), named("b")],
      shared: [named("s1"), named("s2", "p1", "restricted"), named("s3", "p1", "open", "paused")],
      rank,
      teamMax: 1,
      profileName: (id) => (id === "p1" ? "Nomic" : "Qwen"),
      levelName: (k) => k[0]!.toUpperCase() + k.slice(1),
      teamMaxName: "Sensitive",
    });
    expect(out.map((c) => [c.source.id, c.shared, c.reason])).toEqual([
      ["b", false, undefined],
      ["c", false, "Uses Qwen; this knowledge base uses Nomic."],
      ["s1", true, undefined],
      ["s2", true, "Classified Restricted; your team is approved up to Sensitive."],
      ["s3", true, "Paused by a platform admin."],
    ]);
  });
});
