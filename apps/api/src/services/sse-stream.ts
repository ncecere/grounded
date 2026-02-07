import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

type SSEStream = Parameters<Parameters<typeof streamSSE>[1]>[0];

export interface SseController {
  stream: SSEStream;
  isAborted: () => boolean;
  writeJson: (payload: unknown) => Promise<void>;
}

export interface StreamWithHeartbeatOptions {
  onStream: (controller: SseController) => Promise<void>;
  onAbort?: () => void;
  heartbeatMs?: number;
}

export function setSSEHeaders(c: Context): void {
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  c.header("Connection", "keep-alive");
}

export function streamWithHeartbeat(
  c: Context,
  options: StreamWithHeartbeatOptions
): Response {
  const heartbeatMs = options.heartbeatMs ?? 2000;

  setSSEHeaders(c);

  return streamSSE(c, async (stream) => {
    let aborted = false;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    const isAborted = () => aborted;
    const writeJson = async (payload: unknown) => {
      if (aborted) return;
      await stream.writeSSE({ data: JSON.stringify(payload) });
    };

    stream.onAbort(() => {
      aborted = true;
      options.onAbort?.();
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    });

    heartbeatInterval = setInterval(async () => {
      if (aborted) return;
      try {
        await stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
      } catch {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
      }
    }, heartbeatMs);

    try {
      await options.onStream({ stream, isAborted, writeJson });
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      await stream.close();
    }
  });
}
