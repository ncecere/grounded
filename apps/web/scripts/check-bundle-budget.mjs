import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_LARGEST_BUDGET_BYTES = 650 * 1024;
const DEFAULT_ENTRY_BUDGET_BYTES = 650 * 1024;
const DEFAULT_ROUTE_BUDGET_BYTES = 260 * 1024;

const largestBudget = Number(
  process.env.WEB_BUNDLE_BUDGET_BYTES || DEFAULT_LARGEST_BUDGET_BYTES
);
const entryBudget = Number(
  process.env.WEB_BUNDLE_ENTRY_BUDGET_BYTES || DEFAULT_ENTRY_BUDGET_BYTES
);
const routeBudget = Number(
  process.env.WEB_BUNDLE_ROUTE_BUDGET_BYTES || DEFAULT_ROUTE_BUDGET_BYTES
);

async function main() {
  const assetsDir = join(process.cwd(), "dist", "assets");
  const files = await readdir(assetsDir);
  const jsFiles = files.filter((file) => file.endsWith(".js"));

  if (jsFiles.length === 0) {
    console.error(`[bundle-budget] No JS assets found in ${assetsDir}`);
    process.exit(1);
  }

  let largest = { name: "", size: 0 };
  let entry = { name: "", size: 0 };
  let largestRoute = { name: "", size: 0 };

  for (const file of jsFiles) {
    const fullPath = join(assetsDir, file);
    const info = await stat(fullPath);
    if (info.size > largest.size) {
      largest = { name: file, size: info.size };
    }
    if (file.startsWith("index-") && info.size > entry.size) {
      entry = { name: file, size: info.size };
    }
    if (!file.startsWith("index-") && info.size > largestRoute.size) {
      largestRoute = { name: file, size: info.size };
    }
  }

  const toKiB = (bytes) => (bytes / 1024).toFixed(2);

  const failures = [];

  if (largest.size > largestBudget) {
    failures.push(
      `largest JS chunk ${largest.name} is ${toKiB(largest.size)} KiB, budget is ${toKiB(largestBudget)} KiB`
    );
  }

  if (entry.name && entry.size > entryBudget) {
    failures.push(
      `entry chunk ${entry.name} is ${toKiB(entry.size)} KiB, budget is ${toKiB(entryBudget)} KiB`
    );
  }

  if (largestRoute.name && largestRoute.size > routeBudget) {
    failures.push(
      `largest route chunk ${largestRoute.name} is ${toKiB(largestRoute.size)} KiB, budget is ${toKiB(routeBudget)} KiB`
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[bundle-budget] FAIL ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `[bundle-budget] PASS largest=${largest.name} (${toKiB(largest.size)} KiB <= ${toKiB(largestBudget)} KiB), entry=${entry.name || "n/a"} (${toKiB(entry.size)} KiB <= ${toKiB(entryBudget)} KiB), route=${largestRoute.name || "n/a"} (${toKiB(largestRoute.size)} KiB <= ${toKiB(routeBudget)} KiB)`
  );
}

main().catch((error) => {
  console.error(`[bundle-budget] ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
