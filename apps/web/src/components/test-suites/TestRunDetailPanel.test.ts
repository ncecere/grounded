describe("TestRunDetailPanel module exports", () => {
  it("should export TestRunDetailPanel component", async () => {
    const module = await import("./TestRunDetailPanel");
    expect(module.TestRunDetailPanel).toBeDefined();
  });
});
