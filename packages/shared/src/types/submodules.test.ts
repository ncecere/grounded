import { describe, expect, it } from "bun:test";
import * as api from "./api";
import * as workers from "./workers";
import * as queue from "./queue";
import * as widget from "./widget";
import * as analytics from "./analytics";
import * as admin from "./admin";
import {
  TenantRole,
  IngestionStage,
  getQueueForStage,
  widgetConfigSchema,
  createStageMetricsLog,
  SystemRole,
} from "./index";

describe("shared type submodules", () => {
  it("exposes API types from api submodule", () => {
    expect(api.TenantRole).toBe(TenantRole);
  });

  it("exposes worker types from workers submodule", () => {
    expect(workers.IngestionStage).toBe(IngestionStage);
  });

  it("exposes queue helpers from queue submodule", () => {
    expect(queue.getQueueForStage).toBe(getQueueForStage);
  });

  it("exposes widget schemas from widget submodule", () => {
    expect(widget.widgetConfigSchema).toBe(widgetConfigSchema);
  });

  it("exposes analytics helpers from analytics submodule", () => {
    expect(analytics.createStageMetricsLog).toBe(createStageMetricsLog);
  });

  it("exposes admin roles from admin submodule", () => {
    expect(admin.SystemRole).toBe(SystemRole);
  });
});
