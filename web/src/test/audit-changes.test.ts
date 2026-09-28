/* Audit diffs in words (components/audit/changes.ts): money, months, days, price units, no raw ids, one word for no value, a revoked key. */
import { auditChange, auditMoney } from "../components/audit/changes";

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
    expect(c.before).toEqual({ status: "Active", name: "Sync", prefix: "gr_ab" });
    expect(c.after).toEqual({ status: "Revoked", name: "Sync", prefix: "gr_ab" });
  });
});
