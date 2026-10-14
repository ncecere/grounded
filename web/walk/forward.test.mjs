// The loopback forwarder: what the browser believes is localhost:<port> reaches the environment's Service unchanged.
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startForwarder } from "./forward.mjs";

const open = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((r) => s.close(() => r()))));
});
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))).then((p) => (open.push(server), p));

describe("startForwarder", () => {
  it("passes requests through to the target, with the Host header the client sent", async () => {
    const seen = [];
    const target = http.createServer((req, res) => {
      seen.push({ host: req.headers.host, url: req.url, origin: req.headers.origin });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    const targetPort = await listen(target);
    const fwd = await startForwarder(0, "127.0.0.1", targetPort);
    open.push(fwd);
    const port = fwd.address().port;
    const res = await fetch(`http://localhost:${port}/v1/me`, { headers: { Origin: `http://localhost:${port}` } });
    expect(await res.json()).toEqual({ ok: true });
    expect(seen).toEqual([{ host: `localhost:${port}`, url: "/v1/me", origin: `http://localhost:${port}` }]);
  });

  it("carries a request body and a long streamed response", async () => {
    const target = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => res.end(Buffer.concat(chunks).toString().repeat(2000)));
    });
    const targetPort = await listen(target);
    const fwd = await startForwarder(0, "127.0.0.1", targetPort);
    open.push(fwd);
    const res = await fetch(`http://127.0.0.1:${fwd.address().port}/`, { method: "POST", body: "abcdefghij" });
    expect((await res.text()).length).toBe(20000);
  });

  it("closes the client's connection when the target is not there, and keeps serving", async () => {
    const dead = http.createServer();
    const deadPort = await listen(dead);
    await new Promise((r) => dead.close(() => r()));
    open.splice(open.indexOf(dead), 1);
    const fwd = await startForwarder(0, "127.0.0.1", deadPort);
    open.push(fwd);
    await expect(fetch(`http://127.0.0.1:${fwd.address().port}/`)).rejects.toThrow();
    // a second try fails the same way instead of crashing the forwarder
    await expect(fetch(`http://127.0.0.1:${fwd.address().port}/`)).rejects.toThrow();
  });
});
