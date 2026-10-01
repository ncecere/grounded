/* Saved answers (the answer cache, docs/answer-cache.md): Agent → Settings › Saved answers, and the platform switch in Admin → Overview › Features. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { AnswerCacheSwitch, answerCacheText, useAnswerCacheSetting } from "../pages/admin/overview/answer-cache-switch";
import { AnswerCacheSection, cacheSummary, expiryLabel } from "../pages/agents/answer-cache";
import { mockApi } from "./harness";

afterEach(() => vi.unstubAllGlobals());

const cache = (extra: Partial<Schemas["AgentAnswerCache"]> = {}): Schemas["AgentAnswerCache"] => ({
  enabled: null,
  on: true,
  audience: "public",
  nearIdentical: false,
  nearIdenticalAvailable: true,
  expiryHours: 24,
  platformEnabled: true,
  entries: 12,
  hits: 30,
  revision: 3,
  updatedAt: null,
  ...extra,
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const path = "/v1/teams/registrar/agents/ag1/answer-cache";

describe("Agent → Settings › Saved answers", () => {
  it("shows the state, saves a change with If-Match and clears after confirming", async () => {
    let current = cache();
    const calls = mockApi({
      [`GET ${path}`]: () => current,
      [`PUT ${path}`]: (body) => (current = { ...current, ...(body as object), revision: current.revision + 1 }),
      [`POST ${path}/clear`]: () => ({ cleared: 12 }),
    });
    const { container } = wrap(<AnswerCacheSection team="registrar" agentId="ag1" />);
    expect(await screen.findByText(/12 saved answers, reused 30 times/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Reuse answers" })).toBeChecked();
    expect(screen.getByText(/On by default for public agents/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: "Also reuse answers to near-identical questions" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"3"');
    expect(put.body).toEqual({ enabled: null, nearIdentical: true, expiryHours: 24 });

    await userEvent.click(screen.getByRole("button", { name: "Clear saved answers" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Clear saved answers" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/clear"))).toBe(true));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says when the platform switch is off and when near-identical matching needs SystemOne", async () => {
    mockApi({ [`GET ${path}`]: () => cache({ platformEnabled: false, nearIdenticalAvailable: false, audience: "team", on: false, entries: 0 }) });
    const { container } = wrap(<AnswerCacheSection team="registrar" agentId="ag1" />);
    expect(await screen.findByText("Turned off for every agent")).toBeInTheDocument();
    expect(screen.getByText(/Needs a SystemOne model/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Also reuse answers to near-identical questions" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Clear saved answers" })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("words", () => {
    expect(expiryLabel(1)).toBe("1 hour");
    expect(expiryLabel(24)).toBe("24 hours");
    expect(expiryLabel(72)).toBe("3 days");
    expect(cacheSummary(cache({ entries: 1, hits: 1 }))).toBe("1 saved answer, reused once.");
    expect(cacheSummary(cache({ on: false }))).toBe("Each question is answered afresh.");
  });
});

function Switcher({ isAdmin }: { isAdmin: boolean }) {
  const setting = useAnswerCacheSetting();
  return <AnswerCacheSwitch setting={setting} isAdmin={isAdmin} />;
}

describe("Admin → Overview › Features › Saved answers", () => {
  it("asks before turning saved answers off for every agent", async () => {
    let st = { enabled: true, revision: 1, updatedAt: "2026-09-30T10:00:00Z" };
    const calls = mockApi({
      "GET /v1/admin/settings/answer-cache": () => st,
      "PUT /v1/admin/settings/answer-cache": (body) => (st = { ...st, ...(body as object), revision: st.revision + 1 }),
    });
    wrap(<Switcher isAdmin />);
    const toggle = await screen.findByRole("switch", { name: "Allow saved answers" });
    await userEvent.click(toggle);
    const dialog = await screen.findByRole("alertdialog", { name: "Turn saved answers off for every agent?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Turn saved answers off" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ enabled: false }));
    expect(answerCacheText(false)).toMatch(/answered afresh/);
  });
});
