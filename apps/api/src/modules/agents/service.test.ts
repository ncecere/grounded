import { describe, expect, it } from "bun:test";

import {
  buildWidgetConfigUpdate,
  createAgent,
  createChatEndpoint,
  createWidgetToken,
  deleteAgent,
  getAgentDetails,
  getAgentKbs,
  getRetrievalConfig,
  getWidgetConfig,
  getWidgetToken,
  listAgentsWithKbs,
  listChatEndpoints,
  listModels,
  revokeChatEndpoint,
  revokeWidgetToken,
  updateAgent,
  updateAgentKbs,
  updateRetrievalConfig,
  updateWidgetConfig,
} from "./service";

describe("agent service exports", () => {
  const exportsList = [
    listModels,
    listAgentsWithKbs,
    createAgent,
    getAgentDetails,
    updateAgent,
    deleteAgent,
    getAgentKbs,
    updateAgentKbs,
    getRetrievalConfig,
    updateRetrievalConfig,
    getWidgetConfig,
    updateWidgetConfig,
    getWidgetToken,
    createWidgetToken,
    revokeWidgetToken,
    listChatEndpoints,
    createChatEndpoint,
    revokeChatEndpoint,
  ];

  exportsList.forEach((exported) => {
    it("should export service function", () => {
      expect(typeof exported).toBe("function");
    });
  });
});

describe("buildWidgetConfigUpdate", () => {
  it("should merge theme updates when existing theme is present", () => {
    const updateData = buildWidgetConfigUpdate(
      {
        isPublic: true,
        allowedDomains: ["example.com"],
        theme: { primaryColor: "#111111" },
      },
      {
        primaryColor: "#000000",
        backgroundColor: "#ffffff",
      }
    );

    expect(updateData.updatedAt).toBeInstanceOf(Date);
    expect(updateData.isPublic).toBe(true);
    expect(updateData.allowedDomains).toEqual(["example.com"]);
    const theme = updateData.theme as Record<string, unknown> | undefined;
    expect(theme?.primaryColor).toBe("#111111");
    expect(theme?.backgroundColor).toBe("#ffffff");
  });

  it("should skip theme update when existing theme is missing", () => {
    const updateData = buildWidgetConfigUpdate(
      {
        oidcRequired: false,
        theme: { primaryColor: "#222222" },
      },
      null
    );

    expect(updateData.updatedAt).toBeInstanceOf(Date);
    expect(updateData.oidcRequired).toBe(false);
    expect(updateData.theme).toBeUndefined();
  });
});
