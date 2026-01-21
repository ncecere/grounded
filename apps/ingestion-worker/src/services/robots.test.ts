import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  ROBOTS_TXT_DISABLED_ENV_VAR,
  RobotsOverrideType,
  buildRobotsTxtCacheKey,
  createRobotsTxtNotFound,
} from "@grounded/shared";
import { redis } from "@grounded/queue";
import { fetchRobotsTxt, filterUrlsByRobotsRules } from "./robots";

const originalEnv = process.env[ROBOTS_TXT_DISABLED_ENV_VAR];

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[ROBOTS_TXT_DISABLED_ENV_VAR];
  } else {
    process.env[ROBOTS_TXT_DISABLED_ENV_VAR] = originalEnv;
  }
});

describe("filterUrlsByRobotsRules", () => {
  it("returns override when robots.txt is globally disabled", async () => {
    process.env[ROBOTS_TXT_DISABLED_ENV_VAR] = "true";

    const fetchSpy = spyOn(globalThis, "fetch");
    const result = await filterUrlsByRobotsRules(["https://example.com/path"], true);

    expect(result.allowed).toEqual(["https://example.com/path"]);
    expect(result.blocked).toEqual([]);
    expect(result.overrideUsed).toBe(true);
    expect(result.overrideType).toBe(RobotsOverrideType.GLOBAL_DISABLED);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("returns override when source disables robots.txt", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    const result = await filterUrlsByRobotsRules(["https://example.com/path"], false);

    expect(result.allowed).toEqual(["https://example.com/path"]);
    expect(result.blocked).toEqual([]);
    expect(result.overrideUsed).toBe(true);
    expect(result.overrideType).toBe(RobotsOverrideType.SOURCE_OVERRIDE);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

describe("fetchRobotsTxt", () => {
  it("returns allow-all result on 404", async () => {
    const getSpy = spyOn(redis, "get").mockResolvedValue(null);
    const setSpy = spyOn(redis, "set").mockResolvedValue("OK");
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));

    const result = await fetchRobotsTxt("example.com", "https://example.com");

    expect(result.httpStatus).toBe(404);
    expect(result.isValid).toBe(true);
    expect(setSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();

    getSpy.mockRestore();
    setSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("uses cached robots.txt from redis", async () => {
    const cached = createRobotsTxtNotFound();
    const getSpy = spyOn(redis, "get").mockResolvedValue(JSON.stringify(cached));
    const setSpy = spyOn(redis, "set").mockResolvedValue("OK");
    const fetchSpy = spyOn(globalThis, "fetch");

    const result = await fetchRobotsTxt("cache.example", "https://cache.example/one");

    expect(getSpy).toHaveBeenCalledWith(buildRobotsTxtCacheKey("cache.example"));
    expect(result).toMatchObject({ httpStatus: 404, isValid: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();

    getSpy.mockRestore();
    setSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});
