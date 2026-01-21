import { describe, expect, it, mock } from "bun:test";

const runMigrationsMock = mock(async () => {});
const seedSystemAdminMock = mock(async () => {});
const initializeVectorStoreMock = mock(async () => {});
const isVectorStoreConfiguredMock = mock(() => false);
const startTestSuiteSchedulerMock = mock(async () => {});
const stopTestSuiteSchedulerMock = mock(() => {});
const recoverOrphanedLocksMock = mock(async () => {});
const startPeriodicRecoveryMock = mock(() => {});
const stopPeriodicRecoveryMock = mock(() => {});
const logInfoMock = mock(() => {});
const logWarnMock = mock(() => {});
const logErrorMock = mock(() => {});

mock.module("@grounded/vector-store", () => ({
  initializeVectorStore: initializeVectorStoreMock,
  isVectorStoreConfigured: isVectorStoreConfiguredMock,
}));

mock.module("@grounded/logger", () => ({
  log: {
    info: logInfoMock,
    warn: logWarnMock,
    error: logErrorMock,
  },
}));

mock.module("./run-migrations", () => ({
  runMigrations: runMigrationsMock,
}));

mock.module("./seed-admin", () => ({
  seedSystemAdmin: seedSystemAdminMock,
}));

mock.module("../services/test-suite-scheduler", () => ({
  startTestSuiteScheduler: startTestSuiteSchedulerMock,
  stopTestSuiteScheduler: stopTestSuiteSchedulerMock,
}));

mock.module("../services/test-suite-lock-recovery", () => ({
  recoverOrphanedLocks: recoverOrphanedLocksMock,
  startPeriodicRecovery: startPeriodicRecoveryMock,
  stopPeriodicRecovery: stopPeriodicRecoveryMock,
}));

const { runStartupTasks, stopStartupTasks } = await import("./index");

describe("startup index", () => {
  it("runs startup tasks and logs missing vector store", async () => {
    await runStartupTasks();

    expect(runMigrationsMock).toHaveBeenCalled();
    expect(seedSystemAdminMock).toHaveBeenCalled();
    expect(isVectorStoreConfiguredMock).toHaveBeenCalled();
    expect(initializeVectorStoreMock).not.toHaveBeenCalled();
    expect(recoverOrphanedLocksMock).toHaveBeenCalled();
    expect(startPeriodicRecoveryMock).toHaveBeenCalled();
    expect(startTestSuiteSchedulerMock).toHaveBeenCalled();
    expect(logWarnMock).toHaveBeenCalledWith(
      "api",
      expect.stringContaining("Vector store not configured")
    );
  });

  it("stops startup background tasks", () => {
    stopStartupTasks();

    expect(stopTestSuiteSchedulerMock).toHaveBeenCalled();
    expect(stopPeriodicRecoveryMock).toHaveBeenCalled();
  });
});
