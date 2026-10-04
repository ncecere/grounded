import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { thinkingConflict } from "../pages/admin/models/model-form";
import { initialProfileForm, missingPrefixes, prefillPrefixes, profileBody, profileErrors, profileFusionForm, profileFusionPatch, recommendedPrefixes } from "../pages/admin/models/profile-form";
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
    const dialog = await screen.findByRole("region", { name: /^Edit Qwen/ });
    // A bitop-ui Disclosure (G8): a button that says whether it's expanded.
    const compat = within(dialog).getByRole("button", { name: "Compatibility" });
    expect(compat).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(compat);
    expect(compat).toHaveAttribute("aria-expanded", "true");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Honours tool_choice" }), "yes");
    // How to turn thinking off (reasoning effort Off): not supported by default.
    const off = within(dialog).getByRole("combobox", { name: "How to turn thinking off" });
    expect(off).toHaveValue("");
    await userEvent.selectOptions(off, "enable_thinking_false");
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
    expect(body.compat).toEqual({
      thinkingField: "reasoning_content",
      supportsToolChoice: true,
      thinkingOff: "enable_thinking_false",
      extraBody: { chat_template_kwargs: { enable_thinking: false } },
    });
  });

  it("shows a model's compatibility on its record, auditors included (AD-09)", async () => {
    const qwen = { ...chat, compat: { thinkingOff: "enable_thinking_false", supportsReasoningEffort: false, extraBody: { top_k: 20 } } };
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/admin/connections": () => [connection], "GET /v1/admin/models": () => [qwen] });
    const { container } = renderApp("/admin/models?record=m1");
    const sheet = await screen.findByRole("region", { name: "Qwen" }, { timeout: 4000 });
    expect(within(sheet).getByRole("heading", { name: "Compatibility" })).toBeInTheDocument();
    expect(within(sheet).getByText('chat_template_kwargs: {"enable_thinking": false}')).toBeInTheDocument();
    expect(within(sheet).getByText('{"top_k":20}')).toBeInTheDocument();
    expect(within(sheet).getByText("Tool calling").nextSibling).toHaveTextContent("Supported");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("sets a connection's requests per minute (AD-12) and says in words why Delete is off (AD-33)", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/connections": () => [{ ...connection, requestsPerMinute: 0 }],
      "GET /v1/admin/models": () => [chat],
      "PATCH /v1/admin/connections/c1": (body) => ({ ...connection, ...(body as object) }),
    });
    renderApp("/admin/connections?record=c1");
    const sheet = await screen.findByRole("region", { name: "Self-hosted" }, { timeout: 4000 });
    expect(within(sheet).getByText("Unlimited")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /Delete/ })).toHaveAccessibleDescription("Remove or move this connection's models to delete it.");
    await userEvent.click(within(sheet).getByRole("button", { name: /Edit/ }));
    const form = await screen.findByRole("region", { name: "Edit Self-hosted" });
    await userEvent.type(within(form).getByRole("textbox", { name: /Requests per minute/ }), "120");
    await userEvent.click(within(form).getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect((calls.find((c) => c.method === "PATCH")?.body as { requestsPerMinute: number }).requestsPerMinute).toBe(120));
  });

  it("warns when extra request fields set thinking too (AD-10)", () => {
    const base = { kind: "chat" as const, thinkingOff: "enable_thinking_false" as const };
    expect(thinkingConflict({ ...base, extraBody: '{"chat_template_kwargs": {"enable_thinking": true}}' })).toMatch(/turn thinking on for every request; agents and audiences set to Off still turn it off/);
    expect(thinkingConflict({ ...base, extraBody: '{"chat_template_kwargs": {"enable_thinking": false}}' })).toMatch(/can't turn it on/);
    expect(thinkingConflict({ ...base, thinkingOff: "", extraBody: '{"chat_template_kwargs": {"enable_thinking": true}}' })).toMatch(/Off does nothing/);
    expect(thinkingConflict({ ...base, extraBody: '{"top_k": 20}' })).toBeUndefined();
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
    const dialog = await screen.findByRole("region", { name: /^Edit Qwen/ });
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
    // Qwen3-Embedding: its query instruction is filled in (G7); an edit replaces it.
    const query = within(dialog).getByRole("textbox", { name: "Query prefix" });
    expect(query).toHaveValue("Instruct: Given a question, retrieve passages that answer it\nQuery: ");
    await userEvent.clear(query);
    expect(within(dialog).getByText("Qwen3-Embedding expects a query prefix")).toBeInTheDocument();
    await userEvent.type(query, "Instruct: find{Enter}Query: ");
    expect(within(dialog).queryByText(/expects a query prefix/)).toBeNull();
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
    const sheet = await screen.findByRole("region", { name: "Qwen 768" });
    expect(within(sheet).getByText("Vector 1 · keyword 0.02")).toBeInTheDocument();
    expect(within(sheet).getByText(/shortened from the model's vectors/)).toBeInTheDocument();
    expect(await within(sheet).findByText("2 data sources")).toBeInTheDocument();
    // Delete and Retire on the record (AD-15): Delete off while it's used, saying why.
    expect(within(sheet).getByRole("button", { name: /Delete/ })).toHaveAccessibleDescription("A profile in use can't be deleted; retire it instead.");
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

  it("fills in and warns about known models' prefixes (G7)", async () => {
    const nomic = { ...embed, id: "m3", key: "nomic", upstreamModel: "nomic-embed-text-v1.5", displayName: "Nomic", dimensions: 768 };
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/models": () => [nomic, embed], "GET /v1/admin/embedding-profiles": () => [] });
    renderApp("/admin/embedding-profiles");
    await userEvent.click(await screen.findByRole("button", { name: "Add profile" }));
    const dialog = await screen.findByRole("dialog");
    const doc = await within(dialog).findByRole("textbox", { name: "Document prefix" });
    const query = within(dialog).getByRole("textbox", { name: "Query prefix" });
    await waitFor(() => expect(doc).toHaveValue("search_document: "));
    expect(query).toHaveValue("search_query: ");
    // Emptied by hand: a warning with a way back.
    await userEvent.clear(doc);
    await userEvent.clear(query);
    expect(within(dialog).getByText("nomic-embed expects prefixes")).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Use the recommended prefixes" }));
    expect(doc).toHaveValue("search_document: ");
    // Another model replaces the recommendation it didn't type.
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Embedding model" }), "m2");
    expect(doc).toHaveValue("");
    expect(query).toHaveValue("Instruct: Given a question, retrieve passages that answer it\nQuery: ");
  });

  it("knows the prefixes of nomic and Qwen3 embedding models", () => {
    const nomic = recommendedPrefixes({ upstreamModel: "nomic-ai/nomic-embed-text-v1.5" })!;
    expect(nomic).toMatchObject({ documentPrefix: "search_document: ", queryPrefix: "search_query: " });
    expect(recommendedPrefixes({ upstreamModel: "Qwen/Qwen3-Embedding-8B" })?.documentPrefix).toBe("");
    expect(recommendedPrefixes({ upstreamModel: "text-embedding-3-large" })).toBeUndefined();
    expect(prefillPrefixes({ documentPrefix: "mine: ", queryPrefix: "" }, undefined, nomic)).toEqual({ documentPrefix: "mine: ", queryPrefix: "search_query: " });
    expect(prefillPrefixes({ documentPrefix: "search_document: ", queryPrefix: "search_query: " }, nomic, undefined)).toEqual({ documentPrefix: "", queryPrefix: "" });
    expect(missingPrefixes({ documentPrefix: "", queryPrefix: "search_query: " }, nomic)).toEqual(["document"]);
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
