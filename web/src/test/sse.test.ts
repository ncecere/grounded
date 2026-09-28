import { SSEParser, type SSEMessage, readSSE } from "../lib/sse";

function parse(chunks: string[]) {
  const out: SSEMessage[] = [];
  const p = new SSEParser((m) => out.push(m));
  for (const c of chunks) p.push(c);
  p.end();
  return out;
}

const stream = (chunks: (string | Uint8Array)[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
      controller.close();
    },
  });

describe("SSE parser", () => {
  it("parses named events with JSON data", () => {
    expect(parse(['event: text_delta\ndata: {"delta":"Hi"}\n\n'])).toEqual([{ event: "text_delta", data: '{"delta":"Hi"}', id: undefined }]);
  });

  it("defaults the event name to message and strips one leading space only", () => {
    expect(parse(["data:  two spaces\n\n", "data:none\n\n"])).toEqual([
      { event: "message", data: " two spaces", id: undefined },
      { event: "message", data: "none", id: undefined },
    ]);
  });

  it("joins multi-line data with newlines", () => {
    expect(parse(["event: x\ndata: line 1\ndata: line 2\ndata:\n\n"])[0]?.data).toBe("line 1\nline 2\n");
  });

  it("ignores : ping comments and unknown fields, and drops events without data", () => {
    expect(parse([": ping\n\n", "event: lonely\n\n", "foo: bar\nevent: done\ndata: {}\n\n"])).toEqual([{ event: "done", data: "{}", id: undefined }]);
  });

  it("handles every chunk boundary, including inside a field name and in CRLF", () => {
    const text = 'event: message_end\r\ndata: {"text":"Final [1]"}\r\n\r\n: ping\r\n\r\nevent: done\ndata: {}\n\n';
    const whole = parse([text]);
    expect(whole.map((m) => m.event)).toEqual(["message_end", "done"]);
    for (let i = 1; i < text.length; i++) {
      expect(parse([text.slice(0, i), text.slice(i)])).toEqual(whole);
    }
    // One character at a time.
    expect(parse([...text])).toEqual(whole);
  });

  it("accepts bare CR line endings", () => {
    expect(parse(["event: a\rdata: 1\r\r"])).toEqual([{ event: "a", data: "1", id: undefined }]);
  });

  it("records id and retry, and drops an event cut off by the end of the stream", () => {
    const out: SSEMessage[] = [];
    const p = new SSEParser((m) => out.push(m));
    p.push("id: 7\nretry: 1500\nevent: a\ndata: 1\n\nevent: b\ndata: 2\n");
    p.end();
    expect(out).toEqual([{ event: "a", data: "1", id: "7" }]);
    expect(p.retry).toBe(1500);
  });

  it("reads a byte stream, decoding UTF-8 split across chunks", async () => {
    const bytes = new TextEncoder().encode('event: text_delta\ndata: {"delta":"classes\u202f[1] é"}\n\n');
    // Split inside the multi-byte U+202F sequence.
    const cut = bytes.indexOf(0xe2) + 1;
    const out: SSEMessage[] = [];
    await readSSE(stream([bytes.slice(0, cut), bytes.slice(cut)]), (m) => out.push(m));
    expect(JSON.parse(out[0]!.data)).toEqual({ delta: "classes\u202f[1] é" });
  });

  it("rejects with AbortError and cancels the stream when aborted", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("event: a\ndata: 1\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const ctrl = new AbortController();
    const out: SSEMessage[] = [];
    const done = readSSE(body, (m) => {
      out.push(m);
      ctrl.abort();
    }, ctrl.signal);
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(out).toHaveLength(1);
    expect(cancelled).toBe(true);
  });
});
