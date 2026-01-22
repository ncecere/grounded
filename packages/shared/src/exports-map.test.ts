import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8")
);
const tsconfig = JSON.parse(
  readFileSync(new URL("../../../tsconfig.json", import.meta.url), "utf-8")
);

describe("shared export maps", () => {
  it("exposes typed subpath exports for shared types", () => {
    expect(packageJson.exports).toMatchObject({
      ".": "./src/index.ts",
      "./types": "./src/types/index.ts",
      "./types/api": "./src/types/api.ts",
      "./types/workers": "./src/types/workers.ts",
      "./types/queue": "./src/types/queue.ts",
      "./types/widget": "./src/types/widget.ts",
      "./types/analytics": "./src/types/analytics.ts",
      "./types/admin": "./src/types/admin.ts",
      "./constants": "./src/constants/index.ts",
      "./utils": "./src/utils/index.ts",
      "./errors": "./src/errors/index.ts",
      "./errors/http": "./src/errors/http.ts",
      "./settings": "./src/settings/index.ts",
    });
  });
});

describe("shared tsconfig path aliases", () => {
  it("defines explicit shared paths for public entrypoints", () => {
    expect(tsconfig.compilerOptions.baseUrl).toBe(".");
    expect(tsconfig.compilerOptions.paths).toMatchObject({
      "@grounded/shared": ["packages/shared/src/index.ts"],
      "@grounded/shared/types": ["packages/shared/src/types/index.ts"],
      "@grounded/shared/types/api": ["packages/shared/src/types/api.ts"],
      "@grounded/shared/types/workers": ["packages/shared/src/types/workers.ts"],
      "@grounded/shared/types/queue": ["packages/shared/src/types/queue.ts"],
      "@grounded/shared/types/widget": ["packages/shared/src/types/widget.ts"],
      "@grounded/shared/types/analytics": ["packages/shared/src/types/analytics.ts"],
      "@grounded/shared/types/admin": ["packages/shared/src/types/admin.ts"],
      "@grounded/shared/constants": ["packages/shared/src/constants/index.ts"],
      "@grounded/shared/utils": ["packages/shared/src/utils/index.ts"],
      "@grounded/shared/errors": ["packages/shared/src/errors/index.ts"],
      "@grounded/shared/errors/http": ["packages/shared/src/errors/http.ts"],
      "@grounded/shared/settings": ["packages/shared/src/settings/index.ts"],
    });
  });
});
