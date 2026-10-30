/* Webhooks (v0.6.0, F3): a webhook's deliveries panel (the last 50 with their status), Send test event and Redeliver. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Reply, mockApi, renderApp } from "./harness";
import { type Store, delivery, hook, teamSettingsRoutes, webhookRoutes } from "./webhooks-fixtures";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const base = "/v1/teams/registrar/webhooks";
const url = "https://hooks.example.edu/grounded";
const slow = { timeout: scaled(5000) };

function setup(deliveries = [delivery()], extra: Record<string, unknown> = {}) {
  const store: Store = { hooks: [hook()], deliveries, secrets: [] };
  const calls = mockApi({ ...teamSettingsRoutes("owner"), ...webhookRoutes(base, store), ...(extra as object) });
  return { store, calls };
}

/** Opens the panel from the row's menu. */
async function openPanel() {
  renderApp("/teams/registrar/settings?tab=webhooks");
  await userEvent.click(await screen.findByRole("button", { name: `Actions for ${url}` }, slow));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Deliveries…" }));
  return screen.findByRole("dialog", { name: "Deliveries" });
}

const all = [
  delivery({ id: "d1", eventType: "agent.published", status: "delivered", attempts: 1, lastStatus: 200 }),
  delivery({ id: "d2", eventType: "source.sync_failed", status: "failed", attempts: 8, lastStatus: 503, lastError: "The receiver answered 503", deliveredAt: null }),
  delivery({ id: "d3", eventType: "webhook.test", status: "pending", attempts: 2, lastStatus: null, lastError: "Could not resolve the host", deliveredAt: null }),
];

describe("the deliveries panel", () => {
  it("lists the deliveries with their status, attempts, the receiver's answer and a short error", async () => {
    setup(all);
    const dialog = await openPanel();
    const table = await within(dialog).findByRole("table", { name: `Deliveries of ${url}` });
    const delivered = await within(table).findByRole("row", { name: /agent\.published/ });
    expect(delivered).toHaveTextContent("Delivered");
    expect(delivered).toHaveTextContent("200");
    const failed = within(table).getByRole("row", { name: /source\.sync_failed/ });
    expect(failed).toHaveTextContent("Failed");
    expect(failed).toHaveTextContent("8");
    expect(failed).toHaveTextContent("503");
    expect(failed).toHaveTextContent("The receiver answered 503");
    const pending = within(table).getByRole("row", { name: /webhook\.test/ });
    expect(pending).toHaveTextContent("Pending");
    expect(pending).toHaveTextContent("Could not resolve the host");
    expect(dialog).toHaveTextContent("the last 50");
    expect(dialog).toHaveTextContent("14 days");
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Deliveries" })).toBeNull());
    // Focus returns to the row's menu button.
    await waitFor(() => expect(screen.getByRole("button", { name: `Actions for ${url}` })).toHaveFocus());
  });

  it("opens from the row itself too", async () => {
    setup(all);
    renderApp("/teams/registrar/settings?tab=webhooks");
    await userEvent.click(await screen.findByRole("button", { name: (name) => name.startsWith(url) }, slow));
    expect(await screen.findByRole("dialog", { name: "Deliveries" })).toBeInTheDocument();
  });

  it("says nothing has been sent yet, and offers a test event", async () => {
    setup([]);
    const dialog = await openPanel();
    expect(await within(dialog).findByText("Nothing has been sent yet.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send test event" })).toBeInTheDocument();
  });

  it("sends a test event and shows its delivery", async () => {
    const { calls } = setup([]);
    const dialog = await openPanel();
    await userEvent.click(await within(dialog).findByRole("button", { name: "Send test event" }));
    const row = await within(dialog).findByRole("row", { name: /webhook\.test/ });
    expect(row).toHaveTextContent("Pending");
    expect(calls.filter((c) => c.method === "POST" && c.url === `${base}/w1/test`)).toHaveLength(1);
  });

  it("sends a delivery's event again from its own row only", async () => {
    const { calls } = setup(all);
    const dialog = await openPanel();
    const failed = await within(dialog).findByRole("row", { name: /source\.sync_failed/ });
    await userEvent.click(within(failed).getByRole("button", { name: "Redeliver source.sync_failed" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.url.endsWith("/redeliver"))).toHaveLength(1));
    expect(calls.find((c) => c.url.endsWith("/redeliver"))?.url).toBe(`${base}/w1/deliveries/d2/redeliver`);
    // The same event again: two source.sync_failed rows now.
    await waitFor(() => expect(within(dialog).getAllByRole("row", { name: /source\.sync_failed/ })).toHaveLength(2));
  });

  it("reads the log again on Refresh", async () => {
    const { calls, store } = setup([delivery()]);
    const dialog = await openPanel();
    await within(dialog).findByRole("row", { name: /agent\.published/ });
    const reads = () => calls.filter((c) => c.method === "GET" && c.url === `${base}/w1/deliveries`).length;
    expect(reads()).toBe(1);
    store.deliveries.unshift(delivery({ id: "d9", eventType: "feedback.submitted" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Refresh" }));
    expect(await within(dialog).findByRole("row", { name: /feedback\.submitted/ })).toBeInTheDocument();
    expect(reads()).toBe(2);
  });

  it("shows why a test event or a redelivery was refused", async () => {
    setup([delivery()], {
      [`POST ${base}/w1/test`]: () => Reply.error(409, "webhooks_off", "Webhooks are turned off"),
      [`POST ${base}/w1/deliveries/d1/redeliver`]: () => Reply.error(404, "not_found", "That delivery is gone"),
    });
    const dialog = await openPanel();
    await userEvent.click(await within(dialog).findByRole("button", { name: "Send test event" }));
    expect(await within(dialog).findByText("Webhooks are turned off")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Redeliver agent.published" }));
    expect(await within(dialog).findByText("That delivery is gone")).toBeInTheDocument();
  });

  it("follows a pending delivery until it is decided", async () => {
    const store: Store = { hooks: [hook()], deliveries: [delivery({ status: "pending", attempts: 0, lastStatus: null, deliveredAt: null })], secrets: [] };
    mockApi({ ...teamSettingsRoutes("owner"), ...webhookRoutes(base, store) });
    const dialog = await openPanel();
    const row = await within(dialog).findByRole("row", { name: /agent\.published/ });
    expect(row).toHaveTextContent("Pending");
    store.deliveries[0] = delivery({ status: "delivered" });
    await waitFor(() => expect(within(dialog).getByRole("row", { name: /agent\.published/ })).toHaveTextContent("Delivered"), { timeout: scaled(9000) });
  }, scaled(20_000));
});
