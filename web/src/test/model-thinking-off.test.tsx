/* A chat model's Test also checks that "How to turn thinking off" works (issue #7): some models ignore every switch. */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const connection = {
  id: "c1",
  name: "Campus gateway",
  description: "",
  baseUrl: "https://ai.example.edu/v1",
  hasApiKey: true,
  apiKeyHint: "abcd",
  timeoutSeconds: 60,
  requestsPerMinute: null,
  maxConcurrentRequests: 8,
  enabled: true,
  modelCount: 1,
  revision: 1,
  createdAt: "",
  updatedAt: "",
};
const chat = {
  id: "m1",
  connectionId: "c1",
  key: "gpt-oss",
  upstreamModel: "gpt-oss-120b",
  displayName: "GPT-OSS 120B",
  description: "",
  kind: "chat",
  maxClassification: "sensitive",
  enabled: true,
  supportsTools: true,
  supportsVision: false,
  contextWindow: 128000,
  compat: {},
  revision: 1,
  createdAt: "",
  updatedAt: "2026-09-26T10:00:00Z",
};
const usage = { models: [], profiles: [] };
const base = { ok: true, latencyMs: 120, reply: "pong", timings: { dnsMs: 4, connectMs: 3, tlsMs: 21, firstByteMs: 95, reused: false } };

async function testModel(result: object) {
  mockApi({
    ...shellRoutes("platform_admin"),
    "GET /v1/admin/connections": () => [connection],
    "GET /v1/admin/models": () => [chat],
    "GET /v1/admin/catalog-usage": () => usage,
    "POST /v1/admin/models/m1/test": () => result,
  });
  const { container } = renderApp("/admin/models");
  const table = await screen.findByRole("table", { name: "Models" }, { timeout: 4000 });
  await userEvent.click(await within(table).findByRole("button", { name: "GPT-OSS 120B" }));
  const sheet = await screen.findByRole("region", { name: "GPT-OSS 120B" });
  await userEvent.click(within(sheet).getByRole("button", { name: "Test model" }));
  expect(await within(sheet).findByText("Answered in 120 ms")).toBeInTheDocument();
  return { sheet, container };
}

describe("model test: thinking off", () => {
  it("warns, with what it means, when the model still reasoned", async () => {
    const { sheet, container } = await testModel({
      ...base,
      thinkingOff: { setting: "reasoning_effort: none", honoured: false, reasoningTokens: 250, message: "Thinking off isn't honoured by this model: it still reasoned with reasoning_effort: none." },
    });
    const warning = within(sheet).getByText("Thinking off isn't honoured by this model", { exact: false }).closest("[data-tone]");
    expect(warning).toHaveAttribute("data-tone", "warning");
    expect(warning).toHaveTextContent("250 reasoning tokens");
    expect(warning).toHaveTextContent("Reasoning effort Off");
    expect(warning).toHaveTextContent("follow-up suggestions");
    expect(within(sheet).getByText("Answered in 120 ms").closest("[data-tone]")).toHaveAttribute("data-tone", "success"); // the test itself passed
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says it works when the model did not reason", async () => {
    const { sheet } = await testModel({
      ...base,
      thinkingOff: { setting: "chat_template_kwargs.enable_thinking: false", honoured: true, message: "Thinking off works: the model did not reason with chat_template_kwargs.enable_thinking: false." },
    });
    expect(within(sheet).getByText("Thinking off works", { exact: false })).toBeInTheDocument();
    expect(within(sheet).queryByText("isn't honoured", { exact: false })).not.toBeInTheDocument();
  });

  it("says the check could not run, without calling the model broken", async () => {
    const { sheet } = await testModel({
      ...base,
      thinkingOff: { setting: "reasoning_effort: none", honoured: false, error: "gateway timeout", message: "Thinking off wasn't checked: the request failed (gateway timeout)." },
    });
    expect(within(sheet).getByText("Thinking off wasn't checked", { exact: false })).toBeInTheDocument();
    expect(within(sheet).queryByText("isn't honoured", { exact: false })).not.toBeInTheDocument();
  });

  it("shows nothing about thinking when the model has no way to turn it off", async () => {
    const { sheet } = await testModel(base);
    expect(within(sheet).queryByText(/Thinking off/)).not.toBeInTheDocument();
  });
});
