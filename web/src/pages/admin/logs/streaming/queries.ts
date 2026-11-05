/* Audit streaming to a SIEM (docs/specs/audit-streaming/DESIGN.md): the shared query, words and helpers. */
import { queryOptions } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "@/api/client";

export type AuditStream = Schemas["AuditStream"];
export type Destination = Schemas["AuditStreamDestination"];
export type DestinationInput = Schemas["AuditStreamDestinationInput"];

export const auditStreamQuery = () =>
  queryOptions({ queryKey: ["admin", "audit-stream"], queryFn: async () => unwrap(await api.GET("/v1/admin/audit-stream")), refetchInterval: 10_000 });

export const errorClassText: Record<string, string> = {
  address: "The address is refused (loopback, link-local or a metadata address) or not valid",
  connect: "Couldn't connect",
  tls: "The TLS handshake failed (check the certificate or the CA)",
  timeout: "Timed out",
  http_3xx: "The endpoint answered with a redirect, which isn't followed",
  http_4xx: "The endpoint refused the request (check the URL and the authorization header)",
  http_5xx: "The endpoint had an error",
  internal: "Grounded couldn't send it",
};

export const formatLabel: Record<string, string> = { splunk_hec: "Splunk HEC", ndjson: "NDJSON", rfc5424: "Syslog (RFC 5424, TLS)" };

/** "3 min", "2 h": how far behind a destination is. */
export function lagText(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} days`;
}

/** Destinations failing, or more than 15 minutes behind, for more than 15 minutes (the admin overview's Needs attention). Behind
 * without failing means entries are held back: a transaction stays open on the database server. */
export const failingLong = (d: Destination, now = Date.now()) =>
  d.enabled && ((!!d.failingSince && now - Date.parse(d.failingSince) > 15 * 60_000) || d.lagSeconds > 15 * 60);

/** What's wrong with the form, by field, before it is sent (the server checks again). */
export function destinationProblems(f: DestinationInput): Partial<Record<keyof DestinationInput, string>> {
  const out: Partial<Record<keyof DestinationInput, string>> = {};
  if (!f.name.trim()) out.name = "Name the destination.";
  const addr = f.address.trim();
  if (f.kind === "https" && !/^https:\/\/[^/@\s]+/.test(addr)) out.address = "Enter an https:// URL.";
  if (f.kind === "syslog" && !/^[^:\s/]+:\d{1,5}$/.test(addr)) out.address = "Enter host:port, for example siem.example.edu:6514.";
  if (f.caPem.trim() && !f.caPem.includes("BEGIN CERTIFICATE")) out.caPem = "Paste a PEM certificate (-----BEGIN CERTIFICATE-----).";
  return out;
}
