import type { Schemas } from "../api/client";
import { initialModelForm, modelSpec, parseExtraBody } from "../pages/admin/models/model-form";

const conn = { id: "c1" } as Schemas["Connection"];

describe("model form", () => {
  it("starts a new model on the first connection with empty optional fields", () => {
    const form = initialModelForm(null, [conn]);
    expect(form).toMatchObject({ connectionId: "c1", kind: "chat", maxClassification: "open", enabled: true, contextWindow: "", supportsDeveloperRole: undefined });
  });

  it("loads an existing model, numbers as strings", () => {
    const model = {
      connectionId: "c2",
      key: "k",
      kind: "embedding",
      dimensions: 768,
      contextWindow: undefined,
      compat: { maxTokensField: "max_completion_tokens", supportsDeveloperRole: true },
    } as unknown as Schemas["Model"];
    const form = initialModelForm(model, [conn]);
    expect(form).toMatchObject({ connectionId: "c2", kind: "embedding", dimensions: "768", contextWindow: "", maxTokensField: "max_completion_tokens", supportsDeveloperRole: true });
  });

  it("sends empty numbers as undefined and only the compat settings that are set", () => {
    const form = { ...initialModelForm(null, [conn]), contextWindow: "8192", maxOutputTokens: "" };
    const spec = modelSpec(form);
    expect(spec.contextWindow).toBe(8192);
    expect(spec.maxOutputTokens).toBeUndefined();
    expect(spec.compat).toEqual({});
    expect(modelSpec({ ...form, maxTokensField: "max_tokens", supportsDeveloperRole: false }).compat).toEqual({ maxTokensField: "max_tokens", supportsDeveloperRole: false });
  });

  it("keeps compat flags the form doesn't edit, and sends tool choice and extraBody", () => {
    const model = {
      kind: "chat",
      compat: { thinkingField: "reasoning_content", supportsStreamUsage: false, extraBody: { chat_template_kwargs: { enable_thinking: false } } },
    } as unknown as Schemas["Model"];
    const form = initialModelForm(model, [conn]);
    expect(form.extraBody).toContain('"enable_thinking": false');
    expect(modelSpec({ ...form, supportsToolChoice: true }).compat).toEqual({
      thinkingField: "reasoning_content",
      supportsStreamUsage: false,
      supportsToolChoice: true,
      extraBody: { chat_template_kwargs: { enable_thinking: false } },
    });
    // Clearing the field removes extraBody.
    expect(modelSpec({ ...form, extraBody: " " }).compat.extraBody).toBeUndefined();
  });

  it("sends Accepts reasoning effort as supportsReasoningEffort, and keeps it on an edit", () => {
    const form = initialModelForm(null, [conn]);
    expect(modelSpec({ ...form, supportsReasoningEffort: true }).compat).toEqual({ supportsReasoningEffort: true });
    const model = { kind: "chat", compat: { supportsReasoningEffort: true } } as unknown as Schemas["Model"];
    expect(modelSpec(initialModelForm(model, [conn])).compat).toEqual({ supportsReasoningEffort: true });
    expect(modelSpec({ ...initialModelForm(model, [conn]), supportsReasoningEffort: undefined }).compat).toEqual({});
  });

  it("sends supportsDimensionsParam for embedding models only", () => {
    const form = { ...initialModelForm(null, [conn]), supportsDimensionsParam: true };
    expect(modelSpec(form).compat.supportsDimensionsParam).toBeUndefined();
    expect(modelSpec({ ...form, kind: "embedding" }).compat).toEqual({ supportsDimensionsParam: true });
  });

  it("validates extraBody as a small JSON object without core fields", () => {
    expect(parseExtraBody("")).toEqual({});
    expect(parseExtraBody('{"chat_template_kwargs":{"enable_thinking":false}}').value).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(parseExtraBody("{nope").error).toMatch(/JSON object/);
    expect(parseExtraBody("[1]").error).toMatch(/JSON object/);
    expect(parseExtraBody("null").error).toMatch(/JSON object/);
    expect(parseExtraBody('{"stream":false,"model":"x","top_k":1}').error).toBe("Remove model, stream: Grounded sets these fields itself.");
    expect(parseExtraBody(JSON.stringify({ pad: "x".repeat(5000) })).error).toMatch(/4096/);
  });
});
