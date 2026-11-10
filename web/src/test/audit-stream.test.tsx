/* Admin → Logs › Streaming (docs/specs/audit-streaming/DESIGN.md): the destinations with their state, adding one (the header value is
 * sent, never shown), Test, the switch being off, auditors reading, and a failing destination under Needs attention. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { destinationProblems, lagText } from "../pages/admin/logs/streaming/queries";
import { mockApi, renderApp, shellRoutes } from "./harness";

const dest = (extra: Partial<Schemas["AuditStreamDestination"]> = {}): Schemas["AuditStreamDestination"] => ({
  id: "d1", name: "Splunk", kind: "https", format: "splunk_hec", address: "https://splunk.example.edu:8088/services/collector/event",
  hasAuthHeader: true, caPem: "", enabled: true, started: true, sentTotal: 1234, lastSentAt: "2026-11-05T10:00:00Z", lastErrorClass: "",
  failingSince: null, nextAttemptAt: null, lagSeconds: 0, revision: 3, createdAt: "2026-11-01T10:00:00Z", ...extra,
});

const stream = (enabled: boolean, destinations: Schemas["AuditStreamDestination"][]): Schemas["AuditStream"] => ({
  settings: { enabled, revision: 2 }, destinations,
});

describe("audit streaming", () => {
  it("checks the form and words the lag", () => {
    expect(destinationProblems({ name: "", kind: "https", format: "ndjson", address: "http://x", caPem: "" })).toEqual({
      name: "Name the destination.", address: "Enter an https:// URL.",
    });
    expect(destinationProblems({ name: "s", kind: "syslog", format: "rfc5424", address: "siem.example.edu", caPem: "nope" })).toEqual({
      address: "Enter host:port, for example siem.example.edu:6514.", caPem: "Paste a PEM certificate (-----BEGIN CERTIFICATE-----).",
    });
    expect([lagText(30), lagText(600), lagText(7200), lagText(400_000)]).toEqual(["30 s", "10 min", "2 h", "5 days"]);
  });

  it("lists destinations, adds one with a header value, and tests one", async () => {
    let current = stream(true, [dest(), dest({ id: "d2", name: "Syslog", kind: "syslog", format: "rfc5424", address: "siem.example.edu:6514", hasAuthHeader: false,
      failingSince: "2026-11-05T09:00:00Z", lastErrorClass: "tls", lagSeconds: 3600 })]);
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/audit-stream": () => current,
      "POST /v1/admin/audit-stream/destinations": (b) => {
        const d = dest({ id: "d3", name: (b as { name: string }).name, enabled: false, started: false, sentTotal: 0, lastSentAt: null, revision: 1 });
        current = { ...current, destinations: [...current.destinations, d] };
        return d;
      },
      "POST /v1/admin/audit-stream/destinations/d1/test": () => ({ delivered: true, errorClass: "" }),
    });
    const { container } = renderApp("/admin/logs?tab=streaming");
    const table = await screen.findByRole("table", { name: "Streaming destinations" });
    expect(within(table).getByText("Failing")).toBeInTheDocument();
    expect(within(table).getByText(/TLS handshake failed/)).toBeInTheDocument();
    expect(within(table).getByText("1 h")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Add destination" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a streaming destination" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add destination" }));
    expect(await within(dialog).findByText("Name the destination.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Elastic");
    await userEvent.click(within(dialog).getByRole("radio", { name: /NDJSON/ }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "URL" }), "https://elastic.example.edu/ingest");
    await userEvent.type(within(dialog).getByLabelText("Authorization header"), "ApiKey s3cret");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add destination" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/destinations"))?.body).toEqual({
      name: "Elastic", kind: "https", format: "ndjson", address: "https://elastic.example.edu/ingest", caPem: "", authHeader: "ApiKey s3cret",
    }));
    expect(await screen.findByText("Elastic was added. Test it, then turn it on.")).toBeInTheDocument();
    expect(screen.queryByText("ApiKey s3cret")).toBeNull();

    await userEvent.click(within(table).getByRole("button", { name: "Actions for Splunk" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Test" }));
    expect(await screen.findByText("A test entry reached Splunk")).toBeInTheDocument();
  });

  it("says when streaming is off, and is read-only for auditors", async () => {
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/admin/audit-stream": () => stream(false, [dest({ enabled: false })]) });
    const { container } = renderApp("/admin/logs?tab=streaming");
    expect(await screen.findByText("Audit streaming is off")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add destination" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions for Splunk" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
