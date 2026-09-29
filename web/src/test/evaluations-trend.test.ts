/* A set's trend against the run before (I3): pure helpers in pages/team/evaluations/trend.ts, and the spend strip's words. */
import type { Schemas } from "../api/client";
import { overviewSets, regressed, setTrend, trendShort, trendText } from "../pages/team/evaluations/trend";
import { resetDay, stripParts } from "../pages/team/spend";
import { shareOfTeam } from "../pages/agents/analytics/spend";

type Brief = NonNullable<Schemas["EvaluationSet"]["lastRun"]>;
const summary = (extra: Partial<Schemas["EvaluationSummary"]>): Schemas["EvaluationSummary"] => ({
  k: 4, questions: 2, passed: 1, failed: 1, missing: 0, notIndexed: 0, errors: 0, cited: 0, citedOnly: 0, refused: 0, ...extra,
});
const run = (kind: Brief["kind"], score: number, status: Brief["status"] = "completed", at = "2026-09-28T10:00:00Z"): Brief => ({
  id: `${kind}-${score}-${at}`, kind, status, createdAt: at, summary: summary(kind === "answer" ? { passRate: score } : { recall: score }),
});

describe("setTrend", () => {
  it("compares the latest completed score with the run before, in whole points", () => {
    const t = setTrend({ lastRun: run("retrieval", 0.7), previousRun: run("retrieval", 0.8) });
    expect(t).toMatchObject({ score: 0.7, previous: 0.8, points: -10, direction: "down" });
    expect(trendText(t)).toBe("Down 10 points from 80%");
    expect(trendShort(t)).toBe("−10 pts");
    const up = setTrend({ lastRun: run("answer", 0.51), previousRun: run("answer", 0.5) });
    expect([up.direction, trendText(up), trendShort(up)]).toEqual(["up", "Up 1 point from 50%", "+1 pts"]);
    const same = setTrend({ lastRun: run("retrieval", 0.801), previousRun: run("retrieval", 0.8) });
    expect([same.direction, trendText(same), trendShort(same)]).toEqual(["same", "No change from 80%", "±0"]);
  });

  it("has no trend without a run before, or while the latest run isn't completed", () => {
    expect(setTrend({ lastRun: run("retrieval", 0.7), previousRun: null }).direction).toBe("none");
    expect(setTrend({ lastRun: run("retrieval", 0.7, "running"), previousRun: run("retrieval", 0.8) }).direction).toBe("none");
    expect(setTrend({ lastRun: null, previousRun: null })).toEqual({ score: undefined, direction: "none" });
    expect(trendText({ direction: "none" })).toBe("");
    expect(trendShort({ direction: "none" })).toBe("");
  });

  it("puts regressions first on the Overview, then the most recently run, then the never run, up to n", () => {
    const x = (name: string, lastRun: Brief | null, previousRun: Brief | null = null) => ({ name, lastRun, previousRun });
    const list = [
      x("B never", null),
      x("A older", run("retrieval", 0.9, "completed", "2026-09-20T10:00:00Z")),
      x("C dropped", run("retrieval", 0.5, "completed", "2026-09-10T10:00:00Z"), run("retrieval", 0.6)),
      x("D newer", run("retrieval", 0.9, "completed", "2026-09-27T10:00:00Z")),
      x("A never", null),
    ];
    expect(overviewSets(list).map((s) => s.name)).toEqual(["C dropped", "D newer", "A older", "A never", "B never"]);
    expect(overviewSets(list, 2)).toHaveLength(2);
    expect(list.filter(regressed).map((s) => s.name)).toEqual(["C dropped"]);
  });
});

describe("the spend strip", () => {
  const st = (extra: Partial<Schemas["TeamBudgetState"]> = {}): Schemas["TeamBudgetState"] => ({
    mode: "enforce", state: "ok", enforced: true, currency: "USD", month: "2026-09-01", resetsAt: "2026-10-01T04:00:00Z", budget: "1.2",
    extensions: null, limit: "1.2", spent: "0.24", percent: 19, warnPercent: 80, ...extra,
  });

  it("says the share, the state and the reset day; Track only adds not enforced", () => {
    expect(stripParts(st())).toEqual(["19%", "Within budget", "resets Oct 1"]);
    expect(stripParts(st({ enforced: false, mode: "track", state: "exhausted", percent: 120 }))).toEqual(["120%", "Over budget", "not enforced", "resets Oct 1"]);
    expect(stripParts(st({ limit: null, budget: null, state: "none", percent: null }))).toEqual(["resets Oct 1"]);
  });

  it("resets on the first day of the next budget month", () => {
    expect(resetDay("2026-09-01")).toBe("Oct 1");
    expect(resetDay("2026-12-01")).toBe("Jan 1");
  });

  it("gives an agent's share of the team's spend", () => {
    expect(shareOfTeam("0.18", "0.24")).toBe("75% of the team's spend");
    expect(shareOfTeam("0", "0")).toBeUndefined();
  });
});
