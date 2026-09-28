/*
 * A Server-Sent Events parser for fetch() streams (EventSource can't POST or
 * send headers). It follows the WHATWG event-stream rules:
 *
 * - Lines end with \n, \r\n or \r, and a line ending may be split across
 *   chunks (a chunk ending in \r followed by one starting with \n).
 * - "event:" names the event (default "message"); "data:" lines are joined
 *   with \n; "id:" and "retry:" are recorded; a single space after the colon
 *   is removed; lines starting with ":" are comments (": ping").
 * - A blank line dispatches the event; an event without data lines is
 *   dropped. An unterminated event at the end of the stream is dropped.
 */

export type SSEMessage = {
  event: string;
  data: string;
  id?: string;
};

export class SSEParser {
  private buffer = "";
  /** The previous chunk ended with \r: a \n at the start of the next is the same line ending. */
  private pendingCR = false;
  private event = "";
  private data: string[] = [];
  private hasData = false;
  private lastId: string | undefined;
  /** The server's reconnection delay hint ("retry:"), in ms. */
  retry: number | undefined;

  constructor(private readonly onMessage: (message: SSEMessage) => void) {}

  /** Feeds decoded text; dispatches every complete event. */
  push(text: string) {
    if (this.pendingCR && text.startsWith("\n")) text = text.slice(1);
    this.pendingCR = false;
    this.buffer += text;
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const c = this.buffer[i];
      if (c !== "\n" && c !== "\r") continue;
      this.line(this.buffer.slice(start, i));
      if (c === "\r") {
        if (i + 1 === this.buffer.length) this.pendingCR = true;
        else if (this.buffer[i + 1] === "\n") i++;
      }
      start = i + 1;
    }
    this.buffer = this.buffer.slice(start);
  }

  /** The stream ended: an event without its blank line is discarded (per spec). */
  end() {
    this.buffer = "";
    this.reset();
  }

  private reset() {
    this.event = "";
    this.data = [];
    this.hasData = false;
  }

  private line(line: string) {
    if (line === "") {
      if (this.hasData) this.onMessage({ event: this.event || "message", data: this.data.join("\n"), id: this.lastId });
      this.reset();
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        this.event = value;
        break;
      case "data":
        this.data.push(value);
        this.hasData = true;
        break;
      case "id":
        if (!value.includes("\0")) this.lastId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        // Unknown fields are ignored.
        break;
    }
  }
}

/**
 * Reads an event stream to the end, calling onMessage for each event.
 * Resolves when the stream ends; rejects with the abort reason (an
 * AbortError) when `signal` aborts.
 */
export async function readSSE(body: ReadableStream<Uint8Array>, onMessage: (message: SSEMessage) => void, signal?: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser(onMessage);
  const cancel = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    signal?.removeEventListener("abort", cancel);
    try {
      reader.releaseLock();
    } catch {
      // Already released or errored.
    }
  }
}
