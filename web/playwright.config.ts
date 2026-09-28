import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { baseURL, outputDir } from "./e2e/support/env";

/*
 * End-to-end suite (web/e2e, README "End-to-end tests"). Playwright starts
 * tools/e2eserver, which runs a real `grounded serve` (bin/grounded, built
 * with the UI) on its own database with development sign-in and the fake
 * model gateway, and removes it all afterwards.
 *
 * Projects: "seed" signs the personas in and sets up the platform; "chromium"
 * runs the specs in parallel, each in its own team; "platform" runs the
 * specs that change platform-wide state (maintenance mode) after them, one
 * at a time. Firefox and WebKit are optional, for local runs:
 * E2E_BROWSERS=firefox,webkit npx playwright test --project=firefox.
 */
const ci = !!process.env.CI;
const extra = (process.env.E2E_BROWSERS ?? "").split(",");
const optional = [
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
].filter((p) => extra.includes(p.name));
const root = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.(e2e|setup)\.ts$/,
  outputDir: path.join(outputDir, "test-results"),
  fullyParallel: true,
  forbidOnly: ci,
  retries: 0,
  workers: ci ? 4 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: ci
    ? [["list"], ["github"], ["html", { outputFolder: path.join(outputDir, "report"), open: "never" }]]
    : [["list"], ["html", { outputFolder: path.join(outputDir, "report"), open: "never" }]],
  use: {
    baseURL,
    trace: ci ? "retain-on-failure" : "on-first-retry",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
    actionTimeout: 15_000,
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [
    { name: "seed", testMatch: /seed\.setup\.ts$/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["seed"], testMatch: /.*\.e2e\.ts$/, testIgnore: /platform\/.*/ },
    { name: "platform", use: { ...devices["Desktop Chrome"] }, dependencies: ["chromium"], testMatch: /platform\/.*\.e2e\.ts$/, fullyParallel: false, workers: 1 },
    ...optional.map((p) => ({ ...p, dependencies: ["seed"], testMatch: /.*\.e2e\.ts$/, testIgnore: /platform\/.*/ })),
  ],
  webServer: {
    command: "go build -o bin/e2eserver ./tools/e2eserver && exec bin/e2eserver",
    cwd: root,
    url: `${baseURL}/readyz`,
    reuseExistingServer: !ci,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
    stdout: "pipe",
    stderr: "pipe",
  },
});
