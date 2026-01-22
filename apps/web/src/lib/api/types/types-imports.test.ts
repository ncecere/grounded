import { describe, expect, it } from "bun:test";

const sourcesManagerUrl = new URL("../../../pages/SourcesManager.tsx", import.meta.url);
const promptAnalysisPanelUrl = new URL(
  "../../../components/test-suites/PromptAnalysisPanel.tsx",
  import.meta.url
);
const promptAnalysisDetailPanelUrl = new URL(
  "../../../components/test-suites/PromptAnalysisDetailPanel.tsx",
  import.meta.url
);
const authApiUrl = new URL("../auth.ts", import.meta.url);
const tenantsApiUrl = new URL("../tenants.ts", import.meta.url);
const adminApiUrl = new URL("../admin.ts", import.meta.url);
const authTypesUrl = new URL("./auth.ts", import.meta.url);
const tenantTypesUrl = new URL("./tenants.ts", import.meta.url);
const knowledgeBaseTypesUrl = new URL("./knowledge-bases.ts", import.meta.url);
const sourceTypesUrl = new URL("./sources.ts", import.meta.url);
const agentTypesUrl = new URL("./agents.ts", import.meta.url);

describe("web api type imports", () => {
  it("should use aliased domain type imports for key components", async () => {
    const sourcesManagerSource = await Bun.file(sourcesManagerUrl).text();
    const promptAnalysisPanelSource = await Bun.file(promptAnalysisPanelUrl).text();
    const promptAnalysisDetailSource = await Bun.file(promptAnalysisDetailPanelUrl).text();

    expect(sourcesManagerSource).toContain('from "@/lib/api/types/sources"');
    expect(sourcesManagerSource).not.toContain('from "../lib/api/types/sources"');

    expect(promptAnalysisPanelSource).toContain('from "@/lib/api/types/test-suites"');
    expect(promptAnalysisPanelSource).not.toContain('from "../../lib/api/types/test-suites"');

    expect(promptAnalysisDetailSource).toContain('from "@/lib/api/types/test-suites"');
    expect(promptAnalysisDetailSource).not.toContain('from "../../lib/api/types/test-suites"');
  });

  it("should use shared admin type imports for tenant data", async () => {
    const authApiSource = await Bun.file(authApiUrl).text();
    const tenantsApiSource = await Bun.file(tenantsApiUrl).text();
    const adminApiSource = await Bun.file(adminApiUrl).text();

    expect(authApiSource).toContain('from "@grounded/shared/types/admin"');
    expect(tenantsApiSource).toContain('from "@grounded/shared/types/admin"');
    expect(adminApiSource).toContain('from "@grounded/shared/types/admin"');
  });

  it("should pull domain DTOs from shared api types", async () => {
    const authTypesSource = await Bun.file(authTypesUrl).text();
    const tenantTypesSource = await Bun.file(tenantTypesUrl).text();
    const knowledgeBaseTypesSource = await Bun.file(knowledgeBaseTypesUrl).text();
    const sourceTypesSource = await Bun.file(sourceTypesUrl).text();
    const agentTypesSource = await Bun.file(agentTypesUrl).text();

    expect(authTypesSource).toContain('from "@grounded/shared/types/api"');
    expect(tenantTypesSource).toContain('from "@grounded/shared/types/api"');
    expect(knowledgeBaseTypesSource).toContain('from "@grounded/shared/types/api"');
    expect(sourceTypesSource).toContain('from "@grounded/shared/types/api"');
    expect(agentTypesSource).toContain('from "@grounded/shared/types/api"');
  });
});
