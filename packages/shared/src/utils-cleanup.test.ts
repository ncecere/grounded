import { describe, expect, it } from "bun:test";
import * as utils from "./utils";

describe("shared utils cleanup", () => {
  it("drops unused helper exports", () => {
    const utilsRecord = utils as Record<string, unknown>;

    expect(utilsRecord.getHostname).toBeUndefined();
    expect(utilsRecord.isSameHost).toBeUndefined();
    expect(utilsRecord.isSubdomain).toBeUndefined();
    expect(utilsRecord.truncate).toBeUndefined();
    expect(utilsRecord.matchesPattern).toBeUndefined();
    expect(utilsRecord.requireEnv).toBeUndefined();
  });
});
