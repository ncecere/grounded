/* The agent editor's save-conflict helpers (docs/ui-review F-04). */
import { changedFields, overlapping, reapply } from "../pages/agents/conflict";

const from = { profile: { name: "Help", description: "" }, config: { instructions: "Be kind.", maxTurns: 4 } };

describe("save conflicts", () => {
  it("re-applies only the user's changes on top of the latest version", () => {
    const mine = { profile: { ...from.profile }, config: { ...from.config, instructions: "Be kind and brief." } };
    const theirs = { profile: { ...from.profile, name: "Registrar help" }, config: { ...from.config, maxTurns: 6 } };
    expect(changedFields(from, mine)).toEqual(["config.instructions"]);
    expect(reapply({ from, mine, theirs })).toEqual({ profile: { name: "Registrar help", description: "" }, config: { instructions: "Be kind and brief.", maxTurns: 6 } });
    expect(overlapping({ from, mine, theirs })).toEqual([]);
  });

  it("names the fields both sides changed differently", () => {
    const mine = { profile: { ...from.profile }, config: { ...from.config, instructions: "Mine." } };
    const theirs = { profile: { ...from.profile }, config: { ...from.config, instructions: "Theirs." } };
    expect(overlapping({ from, mine, theirs })).toEqual(["config.instructions"]);
    const same = { profile: { ...from.profile }, config: { ...from.config, instructions: "Mine." } };
    expect(overlapping({ from, mine, theirs: same })).toEqual([]);
  });
});
