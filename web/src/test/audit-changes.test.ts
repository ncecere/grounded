/* Audit diffs in words (components/audit/changes.ts): money, months, days, price units, no raw ids, one word for no value, a revoked key. */
import { auditChange, auditMoney, changedRows, changeSummary, plainKey, valueText } from "../components/audit/changes";
import { areaOptions, personFilter } from "../components/audit/labels";

describe("audit changes", () => {
  it("shows a budget change in money and words, with no value left out (the diff says Not set)", () => {
    const c = auditChange(
      { action: "costs.budget_update", before: { mode: "inherit", amount: null, warnPercent: null }, after: { mode: "enforce", amount: "0.200000", warnPercent: 80 } },
      "USD",
    );
    expect(c.before).toEqual({ Mode: "Inherit" });
    expect(c.after).toEqual({ Mode: "Enforce", "Monthly budget": "$0.20", "Warn at": "80%" });
  });

  it("shows an extension's month and amount, without its id", () => {
    const c = auditChange({ action: "costs.extension_grant", before: null, after: { extensionId: "e1", month: "2026-09", amount: "1.000000", reason: "Exams" } }, "USD");
    expect(c.after).toEqual({ Month: "September 2026", Extension: "$1.00", Reason: "Exams" });
  });

  it("names price units and keeps a price's decimals", () => {
    const added = auditChange({ action: "costs.price_add", before: null, after: { model: "gpt", effectiveFrom: "2026-10-28", prices: { moderation_requests: "0.000150" } } }, "USD");
    expect(added.after).toEqual({ Model: "gpt", "Effective from": "Oct 28, 2026", "Requests (per request)": "$0.00015" });
    const deleted = auditChange({ action: "costs.price_delete", before: { priceId: "p1", unit: "chat_tokens_in", price: "4.000000", effectiveFrom: "2026-09-01" }, after: null }, "USD");
    expect(deleted.before).toEqual({ Unit: "Input tokens (per 1M tokens)", Price: "$4.00", "Effective from": "Sep 1, 2026" });
    expect(auditMoney("0.200000")).toBe("0.20");
  });

  it("shows a revoked API key as revoked, not as removed fields", () => {
    const c = auditChange({ action: "apikey.revoke", before: { name: "Sync", prefix: "gr_ab", kbIds: null }, after: null });
    expect(c.before).toEqual({ Status: "Active", Name: "Sync", Prefix: "gr_ab" });
    expect(c.after).toEqual({ Status: "Revoked", Name: "Sync", Prefix: "gr_ab" });
  });

  it("sums up a simple change in one line for the list, in money and plain words", () => {
    const budget = { action: "costs.budget_update", before: { mode: "track", amount: "5.000000", warnPercent: null }, after: { mode: "track", amount: null, warnPercent: null } };
    expect(changeSummary(budget, "USD")).toBe(`Monthly budget ${auditMoney("5.000000", "USD")} → none`);
    expect(changeSummary({ action: "kb.update", before: { maxClassification: "open" }, after: { maxClassification: "sensitive" } })).toBe("Max classification open → sensitive");
    // Creations, deletions and larger changes are left to the record page.
    expect(changeSummary({ action: "kb.create", before: null, after: { name: "Handbook" } })).toBeNull();
    expect(changeSummary({ action: "x.y", before: { a: 1, b: 1, c: 1 }, after: { a: 2, b: 2, c: 2 } })).toBeNull();
    expect(changeSummary({ action: "x.y", before: { text: "a".repeat(80) }, after: { text: "b" } })).toBeNull();
  });

  it("names fields and values plainly for the changes table", () => {
    expect(plainKey("maxClassification")).toBe("Max classification");
    expect(plainKey("kbIds")).toBe("KB IDs");
    expect(plainKey("warn_percent")).toBe("Warn percent");
    expect(changedRows({ before: { A: 1, B: "x" }, after: { A: 1, B: "y", C: true } })).toEqual([
      { field: "B", before: "x", after: "y" },
      { field: "C", before: undefined, after: true },
    ]);
    expect(valueText(undefined)).toBe("Not set");
    expect(valueText(["a", "b"])).toBe("a, b");
    expect(valueText({ x: 1 })).toBe('{"x":1}');
  });
});

describe("audit filters", () => {
  it("lets the Area filter find actions by their label, under their area", () => {
    const options = areaOptions(true);
    expect(options.find((o) => o.value === "costs.")).toMatchObject({ label: "Costs (all)", group: "Areas" });
    expect(options.find((o) => o.label.toLowerCase().includes("budget") && o.value === "costs.budget_update")).toMatchObject({ label: "Changed a team budget", group: "Costs" });
    expect(options.find((o) => o.value === "platform.sso_rule_create")?.group).toBe("SSO groups");
    // A team's log offers no platform-only areas or their actions.
    expect(areaOptions(false).some((o) => o.value === "auth." || o.value === "auth.login")).toBe(false);
  });

  it("maps System (group mapping) to the API's actorKind", () => {
    expect(personFilter("system:group_mapping")).toEqual({ actorKind: "group_mapping" });
    expect(personFilter("u1")).toEqual({ actorUserId: "u1" });
    expect(personFilter(undefined)).toEqual({});
  });
});
