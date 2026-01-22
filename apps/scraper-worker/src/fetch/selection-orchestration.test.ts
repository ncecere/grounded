import { beforeEach, describe, expect, it, mock } from "bun:test";

let fetchWithHttpResult = { html: "<html><body>http</body></html>", title: "HTTP" };
let fetchWithPlaywrightResult = { html: "<html><body>playwright</body></html>", title: "Playwright" };
let fetchWithFirecrawlResult = { html: "<html><body>firecrawl</body></html>", title: "Firecrawl" };
let fetchWithHttpError: Error | null = null;
let needsJsResult = false;

const fetchWithHttpMock = mock(async () => {
  if (fetchWithHttpError) {
    throw fetchWithHttpError;
  }
  return fetchWithHttpResult;
});
const fetchWithPlaywrightMock = mock(async () => fetchWithPlaywrightResult);
const fetchWithFirecrawlMock = mock(async () => fetchWithFirecrawlResult);
const needsJsRenderingMock = mock(() => needsJsResult);

mock.module("@grounded/logger", () => ({
  log: {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

mock.module("../services/content-validation", () => ({
  needsJsRendering: needsJsRenderingMock,
  getJsFrameworkIndicators: mock(() => ["data-reactroot"]),
  MIN_BODY_TEXT_LENGTH: 500,
  MIN_TEXT_WITH_FRAMEWORK: 1000,
}));

mock.module("./http", () => ({
  fetchWithHttp: fetchWithHttpMock,
}));

mock.module("./playwright", () => ({
  fetchWithPlaywright: fetchWithPlaywrightMock,
}));

mock.module("./firecrawl", () => ({
  fetchWithFirecrawl: fetchWithFirecrawlMock,
}));

import { selectAndFetch } from "./selection";

describe("selectAndFetch orchestration", () => {
  beforeEach(() => {
    fetchWithHttpError = null;
    needsJsResult = false;
    fetchWithHttpMock.mockClear();
    fetchWithPlaywrightMock.mockClear();
    fetchWithFirecrawlMock.mockClear();
    needsJsRenderingMock.mockClear();
  });

  it("uses firecrawl when fetchMode is firecrawl", async () => {
    const result = await selectAndFetch({
      url: "https://example.com",
      fetchMode: "firecrawl",
      sourceConfig: {},
      browser: {} as any,
    });

    expect(result).toEqual(fetchWithFirecrawlResult);
    expect(fetchWithFirecrawlMock).toHaveBeenCalledTimes(1);
    expect(fetchWithHttpMock).toHaveBeenCalledTimes(0);
    expect(fetchWithPlaywrightMock).toHaveBeenCalledTimes(0);
  });

  it("uses playwright when fetchMode is headless", async () => {
    const result = await selectAndFetch({
      url: "https://example.com",
      fetchMode: "headless",
      sourceConfig: {},
      browser: {} as any,
    });

    expect(result).toEqual(fetchWithPlaywrightResult);
    expect(fetchWithPlaywrightMock).toHaveBeenCalledTimes(1);
    expect(fetchWithHttpMock).toHaveBeenCalledTimes(0);
    expect(fetchWithFirecrawlMock).toHaveBeenCalledTimes(0);
  });

  it("falls back to playwright when HTTP content needs JS", async () => {
    needsJsResult = true;

    const result = await selectAndFetch({
      url: "https://example.com",
      fetchMode: "auto",
      sourceConfig: {},
      browser: {} as any,
    });

    expect(result).toEqual(fetchWithPlaywrightResult);
    expect(fetchWithHttpMock).toHaveBeenCalledTimes(1);
    expect(fetchWithPlaywrightMock).toHaveBeenCalledTimes(1);
  });

  it("returns HTTP result when JS rendering is not needed", async () => {
    needsJsResult = false;

    const result = await selectAndFetch({
      url: "https://example.com",
      fetchMode: "auto",
      sourceConfig: {},
      browser: {} as any,
    });

    expect(result).toEqual(fetchWithHttpResult);
    expect(fetchWithHttpMock).toHaveBeenCalledTimes(1);
    expect(fetchWithPlaywrightMock).toHaveBeenCalledTimes(0);
  });

  it("falls back to playwright when HTTP throws", async () => {
    fetchWithHttpError = new Error("boom");

    const result = await selectAndFetch({
      url: "https://example.com",
      fetchMode: "html",
      sourceConfig: {},
      browser: {} as any,
    });

    expect(result).toEqual(fetchWithPlaywrightResult);
    expect(fetchWithHttpMock).toHaveBeenCalledTimes(1);
    expect(fetchWithPlaywrightMock).toHaveBeenCalledTimes(1);
  });
});
