/* Audit diffs in words (components/audit/changes.ts): money, months, days, price units, no raw ids, one word for no value, a revoked key. */
import { auditChange, auditMoney, changedRows, changeSummary, plainKey, valueText } from "../components/audit/changes";
import { actionLabel, areaOptions, entryTitle, personFilter, viaLabel } from "../components/audit/labels";

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

  it("names reranking settings changes in words, with the model by name and the time limit in ms (adm-4)", () => {
    const e = {
      action: "platform.rerank_settings_update",
      before: { modelId: null, candidates: 40, timeLimitMs: 200 },
      after: { modelId: "r1", model: "Reranker", candidates: 40, timeLimitMs: 2000 },
    };
    expect(changedRows(auditChange(e))).toEqual([
      { field: "Time limit", before: "200 ms", after: `${(2000).toLocaleString()} ms` },
      { field: "Rerank model", before: undefined, after: "Reranker" },
    ]);
    expect(entryTitle({ ...e, targetType: "rerank_settings", targetLabel: "Reranking settings" })).toBe("Changed reranking settings");
    // Entries recorded with the values under "settings" read the same.
    const nested = { action: e.action, before: { modelId: null, settings: { candidates: 40, timeLimitMs: 200 } }, after: { modelId: null, settings: { candidates: 30, timeLimitMs: 200 } } };
    expect(changeSummary(nested)).toBe("Candidates 40 \u2192 30");
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

describe("switches and holds in words", () => {
  it("says which way the evaluations switch went, in On and Off", () => {
    const off = { action: "platform.evaluations", before: { enabled: true }, after: { enabled: false }, targetLabel: "Evaluations" };
    expect(actionLabel(off.action, off)).toBe("Turned evaluations off");
    expect(actionLabel(off.action, { after: { enabled: true } })).toBe("Turned evaluations on");
    // Without the entry (the Area filter), the action's name.
    expect(actionLabel(off.action)).toBe("Turned evaluations on or off");
    expect(changeSummary(off)).toBe("Evaluations On → Off");
    // A target the action already names isn't repeated.
    expect(entryTitle(off)).toBe("Turned evaluations off");
    expect(entryTitle({ action: "platform.model_update", after: null, targetLabel: "GPT" })).toBe("Changed model: GPT");
    expect(valueText(true)).toBe("On");
  });

  it("labels OAuth and MCP tool entries by what happened, and says how the person acted", () => {
    const revoke = (metadata: Record<string, unknown>) => actionLabel("oauth.revoke", { after: null, metadata });
    expect(revoke({ reason: "user" })).toBe("Disconnected an app");
    expect(revoke({ reason: "admin" })).toBe("Disconnected a person's app");
    expect(revoke({ reason: "client", token: "access" })).toBe("App signed out one token");
    expect(revoke({ reason: "refresh_reuse" })).toBe("Connection revoked: a refresh token was reused (possible theft)");
    expect(actionLabel("oauth.token_issue", { after: null, metadata: { grantType: "refresh_token" } })).toBe("App renewed its sign-in");
    expect(actionLabel("oauth.token_issue", { after: null, metadata: { grantType: "authorization_code" } })).toBe("App signed in");
    const call = (metadata: Record<string, unknown>) => actionLabel("mcp.tool_call", { after: null, metadata });
    expect(call({ outcome: "ok" })).toBe("An agent called an MCP tool");
    expect(call({ outcome: "refused", reason: "call_limit" })).toBe("An agent's MCP tool call was refused (call limit)");
    expect(call({ outcome: "timeout" })).toBe("An agent's MCP tool call failed (timeout)");
    // The OAuth switch's title doesn't add its settings record's label (": MCP server").
    const oauth = { action: "platform.mcp_oauth", after: { oauthEnabled: true }, targetLabel: "MCP server", targetType: "mcp_settings" };
    expect(entryTitle(oauth)).toBe("Turned OAuth sign-in for MCP clients on");
    expect(viaLabel({ kind: "oauth", name: "Example Assistant" })).toBe("Connected app: Example Assistant");
    expect(viaLabel({ kind: "api_key" })).toBe("API key");
    expect(viaLabel({ kind: "session" })).toBe("Signed in");
    expect(viaLabel(null)).toBe("");
  });

  it("shows a released hold's status as Active → Released", () => {
    const hold = { scopeType: "team", scopeId: "t1", scopeName: "QA Team", reason: "Matter 14", coversFrom: null, coversTo: null };
    const c = auditChange({ action: "legal_hold.release", before: { ...hold, active: true }, after: { ...hold, active: false, releaseReason: "Done" } });
    expect(changedRows(c)).toEqual([
      { field: "Status", before: "Active", after: "Released" },
      { field: "Release reason", before: undefined, after: "Done" },
    ]);
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
    // An editor's log has no cost entries (they don't see the team's spend): no Costs area or its actions.
    expect(areaOptions(false).some((o) => o.value === "costs.budget_update")).toBe(true);
    expect(areaOptions(false, { hideCosts: true }).some((o) => o.value.startsWith("costs."))).toBe(false);
  });

  it("maps System (group mapping) to the API's actorKind", () => {
    expect(personFilter("system:group_mapping")).toEqual({ actorKind: "group_mapping" });
    expect(personFilter("u1")).toEqual({ actorUserId: "u1" });
    expect(personFilter(undefined)).toEqual({});
  });

  it("names statuses and roles in words, never their codes (AD-29)", () => {
    const status = { action: "agent.status", before: { status: "active" }, after: { status: "disabled_by_team", reason: "" } };
    expect(changeSummary(status)).toBe("Status Enabled → Disabled by team");
    const role = { action: "team.member_role_change", before: { role: "member" }, after: { role: "editor" } };
    expect(changeSummary(role)).toBe("Role Member → Editor");
    const user = { action: "platform.user_suspend", before: { platformRole: "none", status: "active" }, after: { platformRole: "none", status: "suspended" } };
    expect(changeSummary(user)).toBe("Status Active → Suspended");
  });
});
