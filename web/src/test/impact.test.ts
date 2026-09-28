/* The classification-raise dialog names the reason that applies (docs/ui-review F-19). */
import type { Schemas } from "../api/client";
import { agentFix, agentReasons, impactDescription } from "../pages/sources/impact";

const agent = (reasons: ("model" | "audience")[]): Schemas["ImpactedAgent"] => ({
  agentId: "a1", agentName: "Open help", teamId: "t1", teamSlug: "qa", teamName: "QA", modelName: "Small", modelMaxClassification: "open",
  audience: "public", reasons, reasonText: [],
});

describe("classification impact", () => {
  it("names only the reasons that apply", () => {
    expect(agentFix([agent(["audience"])])).toMatch(/audience allowed for the level/);
    expect(agentFix([agent(["audience"])])).not.toMatch(/chat model/);
    expect(agentFix([agent(["model"])])).toMatch(/chat model approved/);
    expect(agentFix([agent(["model"]), agent(["audience"])])).toMatch(/chat model .* or a narrower audience/);
  });
});

describe("classification impact dialog text", () => {
  const impact = (agents: Schemas["ImpactedAgent"][], kbs = 0): Schemas["ClassificationImpact"] => ({
    classification: "sensitive",
    affected: Array.from({ length: kbs }, (_, i) => ({
      teamId: "t", teamSlug: "t", teamName: "T", teamMaxClassification: "open", knowledgeBaseId: `k${i}`, knowledgeBaseName: `KB ${i}`,
    })),
    agents,
  });

  it("uses the agent's own reason sentences, starting with a capital (F-19, P-18)", () => {
    const one = { ...agent(["audience"]), reasonText: ["Its audience (public) isn't allowed for Sensitive data."] };
    const text = impactDescription(impact([one]), "Sensitive");
    expect(text).toBe("1 published agent would break at Sensitive. Open help: Its audience (public) isn't allowed for Sensitive data. Change that and publish the agent again.");
    expect(text).not.toMatch(/chat model/);
    expect(agentReasons(agent(["model"]), "Sensitive")).toEqual(["Its chat model, Small, is approved only up to open."]);
    const many = impactDescription(impact([agent(["audience"]), agent(["audience"])], 1), "Sensitive");
    expect(many).toMatch(/^1 knowledge base and 2 published agents would break at Sensitive\. That knowledge base must detach this source first\. Those agents must be published/);
  });
});
