import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { ContextualCard } from "../pages/sources/contextual";
import { ApiFailure, mockApi, renderWith } from "./web-harness";

afterEach(() => vi.unstubAllGlobals());

const path = "/v1/admin/sources/s1/contextual";
const budget = { maxTokens: 100000, maxTokensPerDay: 100000, maxAmount: "1.000001", maxAmountPerDay: "2.000001", currency: "USD" };
const state = (extra: Partial<Schemas["ContextualChunks"]> = {}): Schemas["ContextualChunks"] => ({
  sourceId: "s1", sourceName: "Policies", classification: "open", platformEnabled: true, enabled: false,
  modelId: null, modelName: "", failurePolicy: "fail", maxCalls: 200, maxCallsPerDay: 200, admission: null,
  cachedContexts: 0, calls: { attempts: 0, ok: 0, unusable: 0, unknown: 0, tokensIn: 0, tokensOut: 0 }, sets: [], revision: 3, ...extra,
});
const models = [{ id: "m1", kind: "chat", enabled: true, displayName: "Context writer", maxClassification: "open" }];

it("shows team members state without configuration or admin requests and passes axe", async () => {
  const calls = mockApi({ "GET /v1/teams/registrar/sources/s1/contextual": () => state() });
  const { container } = renderWith(<ContextualCard sourceId="s1" />, { role: "member" });
  expect(await screen.findByText("Off for this source. No contextual model work is authorized.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Configure contextual chunks" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Estimate saved/ })).toBeNull();
  expect(calls.some((c) => c.url.startsWith("/v1/admin/"))).toBe(false);
  expect(await axe(container)).toHaveNoViolations();
});

it("lets an auditor estimate saved settings but never configure or start a preview", async () => {
  const calls = mockApi({
    [`GET ${path}`]: () => state(),
    [`POST ${path}/estimate`]: () => ({ calls: 3, inputTokensMax: 1000, outputTokensMax: 1152,
      cost: { priceKnown: false, currency: "USD", maxAmount: null }, blockers: [{ code: "contextual_price_unknown", message: "Configure both chat prices before previewing." }] }),
  });
  const { container } = renderWith(<ContextualCard sourceId="s1" />, { role: "member", platformRole: "platform_auditor" });
  await userEvent.click(await screen.findByRole("button", { name: "Estimate saved contextual settings" }));
  expect(await screen.findByText(/Price unknown: configure both/)).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Contextual preview blockers" })).toHaveTextContent("Configure both chat prices");
  expect(screen.queryByRole("button", { name: "Configure contextual chunks" })).toBeNull();
  expect(calls.filter((c) => c.method !== "GET").map((c) => c.url)).toEqual([`${path}/estimate`]);
  expect(await axe(container)).toHaveNoViolations();
});

it("requires explicit limits, preserves decimal text and saves with If-Match without model/preview work", async () => {
  let current = state();
  const calls = mockApi({
    [`GET ${path}`]: () => current,
    "GET /v1/admin/models": () => models,
    [`PUT ${path}`]: (body) => { current = { ...current, ...(body as Schemas["ContextualSettingsInput"]), admission: (body as Schemas["ContextualSettingsInput"]).admission ?? null, modelName: "Context writer", revision: 4 }; return current; },
  });
  renderWith(<ContextualCard sourceId="s1" />, { role: "owner", platformRole: "platform_admin" });
  await userEvent.click(await screen.findByRole("button", { name: "Configure contextual chunks" }));
  const dialog = await screen.findByRole("dialog", { name: "Configure contextual chunks" });
  await userEvent.click(within(dialog).getByRole("switch", { name: "Allow contextual index previews for this source" }));
  const save = within(dialog).getByRole("button", { name: "Save contextual settings" });
  expect(save).toBeDisabled();
  expect(within(dialog).getByLabelText("Build configured-price amount")).toHaveValue("");
  await userEvent.selectOptions(within(dialog).getByLabelText("Context-writing chat model"), "m1");
  for (const [label, value] of [["Build token limit", "100000"], ["UTC-day token limit", "100000"], ["Build configured-price amount", "1.000001"], ["UTC-day configured-price amount", "2.000001"], ["Configured-price currency", "USD"]] as const) {
    await userEvent.type(within(dialog).getByLabelText(label), value);
  }
  expect(await axe(dialog)).toHaveNoViolations();
  await userEvent.click(save);
  await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  const sent = calls.find((c) => c.method === "PUT")!;
  expect(sent.headers.get("If-Match")).toBe('"3"');
  expect(sent.body).toEqual({ enabled: true, modelId: "m1", failurePolicy: "fail", maxCalls: 200, maxCallsPerDay: 200, admission: budget });
  expect(calls.some((c) => c.url.includes("/preview") || c.url.endsWith("/test"))).toBe(false);
});

it("keeps a frozen revision and edits on412, requiring explicit discard/reload before a new revision is used", async () => {
  let stale = false;
  const calls = mockApi({
    [`GET ${path}`]: () => state({ enabled: true, modelId: "m1", modelName: "Context writer", admission: budget, revision: stale ? 4 : 3 }),
    "GET /v1/admin/models": () => models,
    [`PUT ${path}`]: () => { stale = true; return new ApiFailure(412, "revision_mismatch", "Changed elsewhere"); },
  });
  renderWith(<ContextualCard sourceId="s1" />, { role: "owner", platformRole: "platform_admin" });
  await userEvent.click(await screen.findByRole("button", { name: "Configure contextual chunks" }));
  const dialog = await screen.findByRole("dialog", { name: "Configure contextual chunks" });
  const amount = within(dialog).getByLabelText("Build configured-price amount");
  await userEvent.clear(amount);
  await userEvent.type(amount, "3.000001");
  const save = within(dialog).getByRole("button", { name: "Save contextual settings" });
  await userEvent.click(save);
  expect(await screen.findByText("These settings changed elsewhere")).toBeInTheDocument();
  expect(amount).toHaveValue("3.000001");
  await userEvent.click(save);
  await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2));
  expect(calls.filter((c) => c.method === "PUT").map((c) => c.headers.get("If-Match"))).toEqual(['"3"', '"3"']);
  await userEvent.click(within(dialog).getByRole("button", { name: "Discard edits and reload" }));
  await waitFor(() => expect(amount).toHaveValue("1.000001"));
  await userEvent.click(save);
  await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(3));
  expect(calls.filter((c) => c.method === "PUT").at(2)?.headers.get("If-Match")).toBe('"4"');
});
