import { afterAll, afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Worker } from "@grounded/queue";
import { createShutdownHandler, registerShutdownSignals } from "./shutdown";
import * as settings from "./settings";

describe("createShutdownHandler", () => {
  const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);

  afterEach(() => {
    exitSpy.mockClear();
  });

  afterAll(() => {
    exitSpy.mockRestore();
  });

  it("stops settings refresh, closes workers, and exits", async () => {
    const close = mock(async () => undefined);
    const worker = { close } as unknown as Worker;
    const stopSpy = spyOn(settings, "stopSettingsRefresh");

    const shutdown = createShutdownHandler({ workers: [worker] });

    await shutdown();

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);

    stopSpy.mockRestore();
  });

  it("ignores repeated shutdown calls", async () => {
    const close = mock(async () => undefined);
    const worker = { close } as unknown as Worker;

    const shutdown = createShutdownHandler({ workers: [worker] });

    await shutdown();
    await shutdown();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("registerShutdownSignals", () => {
  it("registers SIGTERM and SIGINT handlers", () => {
    const onSpy = spyOn(process, "on").mockImplementation(() => process);
    const shutdown = async () => undefined;

    registerShutdownSignals(shutdown);

    expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));

    onSpy.mockRestore();
  });
});
