import { describe, expect, it, mock } from "bun:test";
import { emailService } from "./email";

describe("emailService", () => {
  it("sends regression alerts with run details", async () => {
    const sendMock = mock(async () => ({ success: true }));
    const originalSend = emailService.send.bind(emailService);
    emailService.send = sendMock as typeof emailService.send;

    const recipients = ["owner@example.com", "admin@example.com"];
    await emailService.sendTestRegressionAlert(recipients, {
      tenantName: "Acme Co",
      agentName: "Support Bot",
      suiteName: "Checkout Regression",
      runId: "run-123",
      previousPassRate: 97.5,
      currentPassRate: 82.5,
      passRateDrop: 15,
      newlyFailingCases: [
        {
          testCaseId: "case-1",
          testCaseName: "Shipping step",
          question: "How do I track my order?",
        },
      ],
      runUrl: "https://app.example.com/agents/agent-1/test-suites/suite-1/runs/run-123",
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: recipients,
        subject: expect.stringContaining("Checkout Regression"),
        html: expect.stringContaining("View Run Details"),
      })
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("Support Bot"),
      })
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("Drop: 15.0%"),
      })
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("Shipping step"),
      })
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining(
          "https://app.example.com/agents/agent-1/test-suites/suite-1/runs/run-123"
        ),
      })
    );

    emailService.send = originalSend;
  });
});
