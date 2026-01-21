import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { WorkerSettings } from "@grounded/shared";
import {
  getCurrentConcurrency,
  getCurrentEmbedConcurrency,
  initializeSettings,
  settingsClient,
} from "./settings";

const baseSettings: WorkerSettings = {
  fairness: {
    enabled: true,
    totalSlots: 5,
    minSlotsPerRun: 1,
    maxSlotsPerRun: 10,
    retryDelayMs: 500,
  },
  scraper: { concurrency: 5 },
  ingestion: { concurrency: 6 },
  embed: { concurrency: 3 },
};

afterEach(() => {
  mock.restore();
});

describe("initializeSettings", () => {
  it("fetches settings and starts periodic refresh", async () => {
    const fetchSpy = spyOn(settingsClient, "fetchSettings").mockResolvedValue(baseSettings);
    const refreshSpy = spyOn(settingsClient, "startPeriodicRefresh").mockImplementation(() => {});

    const result = await initializeSettings();

    expect(result).toEqual(baseSettings);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(getCurrentConcurrency()).toBe(baseSettings.ingestion.concurrency);
    expect(getCurrentEmbedConcurrency()).toBe(baseSettings.embed.concurrency);
  });

  it("returns null when settings fetch fails", async () => {
    spyOn(settingsClient, "fetchSettings").mockRejectedValue(new Error("fetch failed"));
    const refreshSpy = spyOn(settingsClient, "startPeriodicRefresh").mockImplementation(() => {});

    const result = await initializeSettings();

    expect(result).toBeNull();
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});
