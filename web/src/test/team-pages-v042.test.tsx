/* v0.4.2 M3 fixes on the team pages: knowledge base settings and overview, sources, keys and read-only notices. */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Schemas } from "../api/client";
import { TeamContext, teamCtx } from "../pages/team/common";
import { sliderText } from "../pages/team/kbs/fusion";
import { KBSettings } from "../pages/team/kbs/settings";
import { mockApi, renderBare, team } from "./harness";

afterEach(() => vi.unstubAllGlobals());

const stamp = { revision: 1, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" };

const kb = {
  id: "k1",
  name: "Registrar",
  description: "",
  embeddingProfileId: "p1",
  topK: 8,
  sources: [],
  fusionWeights: null,
  effectiveFusionWeights: { vector: 1, keyword: 0.02 },
  fusionWeightsSource: "profile",
  ...stamp,
} as unknown as Schemas["KnowledgeBase"];

describe("knowledge base fusion weights (BU-14)", () => {
  it("shows and keeps a keyword weight of 0.02 on the slider", async () => {
    mockApi({});
    renderBare(
      <TeamContext.Provider value={teamCtx(team as Schemas["Team"], "editor")}>
        <KBSettings kb={kb} onDelete={() => {}} />
      </TeamContext.Provider>,
    );
    await userEvent.click(await screen.findByRole("switch", { name: /Use the default/ }));
    const keyword = screen.getByRole("slider", { name: "Keyword weight" });
    expect(keyword).toHaveAttribute("step", "0.01");
    expect(keyword).toHaveValue("0.02");
    expect(keyword).toHaveAttribute("aria-valuenow", "0.02");
    expect(sliderText(0.019999999552965164)).toBe("0.02");
    expect(sliderText([0.30000000000000004])).toBe("0.3");
  });
});
