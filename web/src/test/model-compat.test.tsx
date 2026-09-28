import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { initialProfileForm, profileBody, profileErrors, profileFusionForm, profileFusionPatch } from "../pages/admin/models/profile-form";
import { TeamContext, teamCtx } from "../pages/team/common";
import { KBSettings } from "../pages/team/kbs/settings";
import { mockApi, renderApp, renderBare, shellRoutes, team } from "./harness";

/* Self-hosted model compatibility (DESIGN.md §6, §10): chat compat fields (tool choice, extra request fields), embedding output dimensions, profile fusion defaults and where a knowledge base's weights come from. */

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const stamp = { revision: 3, createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z" };
const connection = { id: "c1", name: "Self-hosted", description: "", baseUrl: "https://llm.example.edu/v1", hasApiKey: true, timeoutSeconds: 60, enabled: true, modelCount: 2, maxConcurrentRequests: 2, ...stamp };
const chat = {
  id: "m1", connectionId: "c1", key: "qwen", upstreamModel: "qwen3-27b", displayName: "Qwen", description: "", kind: "chat", maxClassification: "open",
  enabled: true, supportsTools: true, supportsVision: false, contextWindow: 65536, compat: { thinkingField: "reasoning_content" }, ...stamp,
};
const embed = {
  id: "m2", connectionId: "c1", key: "qwen-embed", upstreamModel: "qwen3-embedding-4b", displayName: "Qwen embeddings", description: "", kind: "embedding",
  maxClassification: "open", enabled: true, supportsTools: false, supportsVision: false, dimensions: 2560, compat: {}, ...stamp,
};

describe("admin model compatibility fields", () => {
  it("validates extra request fields and saves them with tool choice, keeping other flags", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => [connection],
      "GET /v1/admin/models": () => [chat],
      "PATCH /v1/admin/models/m1": (body) => ({ ...chat, ...(body as object) }),
    });
    renderApp("/admin/models");
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Qwen" }, { timeout: 4000 }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("Compatibility"));
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Honours tool_choice" }), "yes");
    const extra = within(dialog).getByRole("textbox", { name: /Extra request fields/ });
    await userEvent.click(extra);
    await userEvent.paste('{"stream": false}');
    await userEvent.click(within(dialog).getByRole("button", { name: "Save model" }));
    expect(await within(dialog).findByText("Remove stream: Grounded sets these fields itself.")).toBeInTheDocument();
    expect(extra).toHaveAttribute("aria-invalid", "true");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(await axe(dialog)).toHaveNoViolations();

    await userEvent.clear(extra);
    await userEvent.paste('{"chat_template_kwargs": {"enable_thinking": false}}');
    await userEvent.click(within(dialog).getByRole("button", { name: "Save model" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const body = calls.find((c) => c.method === "PATCH")!.body as Schemas["ModelUpdate"];
    expect(body.compat).toEqual({ thinkingField: "reasoning_content", supportsToolChoice: true, extraBody: { chat_template_kwargs: { enable_thinking: false } } });
  });

  it("offers the dimensions parameter for embedding models", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => [connection],
      "GET /v1/admin/models": () => [embed],
      "PATCH /v1/admin/models/m2": (body) => ({ ...embed, ...(body as object) }),
    });
    renderApp("/admin/models");
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Qwen embeddings" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Compatibility")).toBeNull();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Server accepts the dimensions parameter/ }));
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save model" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect((calls.find((c) => c.method === "PATCH")!.body as Schemas["ModelUpdate"]).compat).toEqual({ supportsDimensionsParam: true });
  });
});

describe("embedding profile output dimensions and fusion defaults", () => {
  const profile = {
    id: "p1", key: "qwen-768", name: "Qwen 768", description: "",
    model: { id: "m2", key: "qwen-embed", displayName: "Qwen embeddings", maxClassification: "open", enabled: true },
    dimensions: 768, outputDimensions: 768, storageType: "halfvec", documentPrefix: "", queryPrefix: "Instruct: x\nQuery: ",
    chunkSize: 512, chunkOverlap: 64, chunkerVersion: 1, status: "active", isDefault: true, defaultFusionWeights: { vector: 1, keyword: 0.02 }, ...stamp,
  } as Schemas["EmbeddingProfile"];

  it("creates a profile with output dimensions, a multi-line query prefix and fusion defaults", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/models": () => [embed],
      "GET /v1/admin/embedding-profiles": () => [profile],
      "POST /v1/admin/embedding-profiles": () => profile,
    });
    const { container } = renderApp("/admin/embedding-profiles");
    const table = await screen.findByRole("table", { name: "Embedding profiles" });
    expect(await within(table).findByText("768 · halfvec")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Add profile" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Qwen");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Key" }), "qwen");
    const dims = within(dialog).getByRole("textbox", { name: /Output dimensions/ });
    await userEvent.type(dims, "3000");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Query prefix" }), "Instruct: find{Enter}Query: ");
    await userEvent.click(within(dialog).getByRole("switch", { name: /platform fusion weights/ }));
    const keyword = within(dialog).getByRole("textbox", { name: "Default keyword weight" });
    await userEvent.clear(keyword);
    await userEvent.type(keyword, "0.02");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create profile" }));
    expect(await within(dialog).findByText("Enter a whole number from 1 to 2560.")).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.clear(dims);
    await userEvent.type(dims, "768");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create profile" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({
      modelId: "m2", outputDimensions: 768, queryPrefix: "Instruct: find\nQuery: ", defaultFusionWeights: { vector: 1, keyword: 0.02 },
    });
  });

  it("shows a profile's output dimensions and default fusion weights in its sheet (A5)", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/embedding-profiles": () => [profile], "GET /v1/admin/catalog-usage": () => ({ models: [], profiles: [{ profileId: "p1", sources: 2, knowledgeBases: 1 }] }) });
    renderApp("/admin/embedding-profiles?record=p1");
    const sheet = await screen.findByRole("dialog", { name: "Qwen 768" });
    expect(within(sheet).getByText("Vector 1 · keyword 0.02")).toBeInTheDocument();
    expect(within(sheet).getByText(/shortened from the model's vectors/)).toBeInTheDocument();
    expect(await within(sheet).findByText("2 data sources")).toBeInTheDocument();
  });

  it("edits a profile's fusion defaults", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/embedding-profiles": () => [profile],
      "PATCH /v1/admin/embedding-profiles/p1": () => profile,
    });
    renderApp("/admin/embedding-profiles");
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Qwen 768" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Fusion defaults" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("switch", { name: /platform fusion weights/ }));
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toEqual({ usePlatformFusionWeights: true });
    expect(patch.headers.get("If-Match")).toBe('"3"');
  });

  it("builds and checks the profile body", () => {
    const form = { ...initialProfileForm, key: "q", name: "Q", outputDimensions: " 768 ", fusion: { useDefault: false, vector: "1", keyword: "0" } };
    expect(profileBody(form, "m2")).toMatchObject({ modelId: "m2", outputDimensions: 768, defaultFusionWeights: { vector: 1, keyword: 0 } });
    expect(profileBody({ ...form, outputDimensions: "", fusion: { ...form.fusion, useDefault: true } }, "m2")).toMatchObject({ outputDimensions: undefined, defaultFusionWeights: undefined });
    expect(profileErrors(form, 2560)).toEqual({});
    expect(profileErrors({ ...form, outputDimensions: "2560", storageType: "vector" }, 2560).outputDimensions).toBe("vector supports at most 2000 dimensions.");
    expect(profileErrors({ ...form, outputDimensions: "1.5" }, 2560).outputDimensions).toMatch(/whole number/);
    expect(profileErrors({ ...form, fusion: { useDefault: false, vector: "0", keyword: "0" } }, 2560).fusion).toBe("At least one weight must be above 0.");
    expect(profileFusionForm(profile)).toEqual({ useDefault: false, vector: "1", keyword: "0.02" });
    expect(profileFusionPatch({ useDefault: false, vector: "0.9", keyword: "0" })).toEqual({ defaultFusionWeights: { vector: 0.9, keyword: 0 } });
  });
});

describe("knowledge base fusion source", () => {
  const kb = {
    id: "k1", name: "Registrar", description: "", embeddingProfileId: "p1", topK: 8, sources: [], fusionWeights: null,
    effectiveFusionWeights: { vector: 1, keyword: 0.02 }, fusionWeightsSource: "profile", ...stamp,
  } as unknown as Schemas["KnowledgeBase"];

  it("says the weights in effect come from the embedding profile", async () => {
    mockApi({});
    const { container } = renderBare(
      <TeamContext.Provider value={teamCtx(team as Schemas["Team"], "editor")}>
        <KBSettings kb={kb} onDelete={() => {}} />
      </TeamContext.Provider>,
    );
    // The weights in effect and their source are always shown (W4).
    const effective = await screen.findByText(/In effect now:/);
    expect(effective.closest("p")).toHaveTextContent("In effect now: Vector 1 · keyword 0.02 (from the embedding profile)");
    expect(await axe(container)).toHaveNoViolations();
  });
});
