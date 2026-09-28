import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the harness (tools/e2eserver) serves Grounded and the fake model gateway. */
export const port = process.env.E2E_PORT ?? "18480";
export const baseURL = `http://127.0.0.1:${port}`;
export const fakeURL = `http://${process.env.E2E_FAKE_ADDR ?? "127.0.0.1:18490"}/v1`;
/** tools/e2eserver's fake gateway key and models. */
export const fakeKey = "sk-e2e-fake";
export const fakeChatModel = "e2e-chat";
export const fakeEmbedModel = "e2e-embed";
export const fakeEmbedDims = 64;

const here = path.dirname(fileURLToPath(import.meta.url));
/** web/e2e-output: the server log, reports, traces and signed-in states. */
export const outputDir = path.resolve(here, "../../e2e-output");

/** Development personas (internal/auth/dev.go). */
export type Persona = "admin" | "auditor" | "user" | "alex" | "blair" | "casey";
export const personas: readonly Persona[] = ["admin", "auditor", "user", "alex", "blair", "casey"];
export const personaNames: Record<Persona, string> = {
  admin: "Dev Platform Admin",
  auditor: "Dev Platform Auditor",
  user: "Dev User",
  alex: "Alex Dev",
  blair: "Blair Dev",
  casey: "Casey Dev",
};
export const emailOf = (p: Persona) => `${p}@localhost`;

/** The signed-in browser state of a persona, written by seed.setup.ts. */
export const authFile = (p: Persona) => path.join(outputDir, ".auth", `${p}.json`);
