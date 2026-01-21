import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR,
  PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR,
  SCRAPE_TIMEOUT_MS,
} from "@grounded/shared";
import { fetchWithPlaywright } from "./playwright";

const originalDownloadsDisabled = process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
const originalLogBlocked = process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];

afterEach(() => {
  if (originalDownloadsDisabled === undefined) {
    delete process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
  } else {
    process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = originalDownloadsDisabled;
  }

  if (originalLogBlocked === undefined) {
    delete process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];
  } else {
    process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = originalLogBlocked;
  }
});

describe("fetchWithPlaywright", () => {
  it("uses Playwright to fetch content and closes resources", async () => {
    process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = "true";
    process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = "false";

    const page = {
      goto: mock(async () => {}),
      waitForTimeout: mock(async () => {}),
      content: mock(async () => "<html>Playwright</html>"),
      title: mock(async () => "Playwright"),
      on: mock(() => {}),
      close: mock(async () => {}),
    };

    const context = {
      newPage: mock(async () => page),
      close: mock(async () => {}),
    };

    let receivedOptions: { acceptDownloads?: boolean } | undefined;
    const browser = {
      newContext: mock(async (options: { acceptDownloads?: boolean }) => {
        receivedOptions = options;
        return context;
      }),
    };

    const result = await fetchWithPlaywright(
      "https://example.com",
      browser as unknown as import("playwright").Browser
    );

    expect(result).toEqual({ html: "<html>Playwright</html>", title: "Playwright" });
    expect(receivedOptions?.acceptDownloads).toBe(false);
    expect(page.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "networkidle",
      timeout: SCRAPE_TIMEOUT_MS,
    });
    expect(page.waitForTimeout).toHaveBeenCalledWith(1000);
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });
});
