import { describe, expect, it } from "vitest";
import { contextualFormOf, contextualInputOf, validateContextualForm, type ContextualForm } from "../pages/sources/contextual-form";

const good = (): ContextualForm => ({
  enabled: true,
  modelId: "00000000-0000-4000-8000-000000000001",
  failurePolicy: "fail",
  maxCalls: "200",
  maxCallsPerDay: "200",
  maxTokens: "100000",
  maxTokensPerDay: "100000",
  maxAmount: "1.000001",
  maxAmountPerDay: "2.000001",
  currency: "USD",
});

describe("contextual admission form", () => {
  it("does not invent budgets when the off-by-default state is opened", () => {
    const f = contextualFormOf({ enabled: false, modelId: null, failurePolicy: "fail", maxCalls: 200, maxCallsPerDay: 200, admission: null });
    expect(f.maxTokens).toBe("");
    expect(f.maxAmount).toBe("");
    expect(f.currency).toBe("");
    expect(validateContextualForm(f)).toEqual({});
    expect(contextualInputOf(f).admission).toBeNull();
    expect(Object.keys(validateContextualForm({ ...f, enabled: true }))).toEqual(["modelId", "maxTokens", "maxTokensPerDay", "maxAmount", "maxAmountPerDay", "currency"]);
  });

  it("preserves exact money text and requires independent build/day controls", () => {
    const f = good();
    f.maxAmount = "99999999999999.123456";
    expect(validateContextualForm(f)).toEqual({});
    expect(contextualInputOf(f).admission).toEqual({ maxTokens: 100000, maxTokensPerDay: 100000, maxAmount: f.maxAmount, maxAmountPerDay: "2.000001", currency: "USD" });
    expect(validateContextualForm({ ...f, maxTokensPerDay: "" })).toHaveProperty("maxTokensPerDay");
    expect(validateContextualForm({ ...f, maxAmountPerDay: "" })).toHaveProperty("maxAmountPerDay");
  });

  it.each(["", "0", "0.000000", "-1", "1e6", "NaN", "Infinity", "1.0000001", "100000000000000", " 1 "])("rejects invalid amount %j without float coercion", (amount) => {
    expect(validateContextualForm({ ...good(), maxAmount: amount })).toHaveProperty("maxAmount");
  });

  it.each(["0", "-1", "1.5", "1e3", "Infinity", "100001"])("rejects invalid call count %j", (n) => {
    expect(validateContextualForm({ ...good(), maxCalls: n })).toHaveProperty("maxCalls");
  });

  it("allows the smallest positive decimal and validates token/currency bounds", () => {
    expect(validateContextualForm({ ...good(), maxAmount: "0.000001", maxTokens: "1000000000" })).toEqual({});
    expect(validateContextualForm({ ...good(), maxTokens: "1000000001" })).toHaveProperty("maxTokens");
    expect(validateContextualForm({ ...good(), currency: "usd" })).toHaveProperty("currency");
  });

  it("can turn generation off without retaining or filling absent budget/model fields", () => {
    const f = { ...good(), enabled: false, maxAmount: "", maxTokens: "", modelId: "" };
    expect(validateContextualForm(f)).toEqual({});
    expect(contextualInputOf(f)).toEqual({ enabled: false, modelId: null, failurePolicy: "fail", maxCalls: 200, maxCallsPerDay: 200, admission: null });
  });
});
