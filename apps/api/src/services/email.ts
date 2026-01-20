import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db } from "@grounded/db";
import { systemSettings } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import { log } from "@grounded/logger";

// ============================================================================
// Types
// ============================================================================

interface EmailConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

interface TenantHealthAlert {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  flags: string[];
  healthScore: number;
  errorRate: number;
  totalQueries: number;
}

interface TestRegressionAlert {
  tenantName: string;
  agentName: string;
  suiteName: string;
  runId: string;
  previousPassRate: number;
  currentPassRate: number;
  passRateDrop: number;
  newlyFailingCases: Array<{ testCaseId: string; testCaseName: string; question: string }>;
  runUrl: string;
}

// ============================================================================
// Email Service
// ============================================================================

class EmailService {
  private transporter: Transporter | null = null;
  private config: EmailConfig | null = null;
  private configLoadedAt: number = 0;
  private readonly CONFIG_CACHE_MS = 60000; // 1 minute cache

  /**
   * Load email configuration from database
   */
  async loadConfig(): Promise<EmailConfig> {
    const now = Date.now();
    if (this.config && now - this.configLoadedAt < this.CONFIG_CACHE_MS) {
      return this.config;
    }

    const settings = await db.query.systemSettings.findMany({
      where: (s, { like }) => like(s.key, "email.%"),
    });

    const settingsMap = new Map(settings.map((s) => [s.key, JSON.parse(s.value)]));

    this.config = {
      enabled: settingsMap.get("email.smtp_enabled") ?? false,
      host: settingsMap.get("email.smtp_host") ?? "",
      port: settingsMap.get("email.smtp_port") ?? 587,
      secure: settingsMap.get("email.smtp_secure") ?? false,
      user: settingsMap.get("email.smtp_user") ?? "",
      password: settingsMap.get("email.smtp_password") ?? "",
      fromAddress: settingsMap.get("email.from_address") ?? "",
      fromName: settingsMap.get("email.from_name") ?? "Grounded Platform",
    };
    this.configLoadedAt = now;

    // Reset transporter when config changes
    this.transporter = null;

    return this.config;
  }

  /**
   * Get or create the nodemailer transporter
   */
  private async getTransporter(): Promise<Transporter | null> {
    const config = await this.loadConfig();

    if (!config.enabled || !config.host) {
      return null;
    }

    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user
          ? {
              user: config.user,
              pass: config.password,
            }
          : undefined,
      });
    }

    return this.transporter;
  }

  /**
   * Check if email is configured and enabled
   */
  async isConfigured(): Promise<boolean> {
    const config = await this.loadConfig();
    return config.enabled && !!config.host && !!config.fromAddress;
  }

  /**
   * Send an email
   */
  async send(options: SendEmailOptions): Promise<{ success: boolean; error?: string }> {
    try {
      const transporter = await this.getTransporter();
      if (!transporter) {
        return { success: false, error: "Email not configured" };
      }

      const config = await this.loadConfig();

      await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromAddress}>`,
        to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || options.html.replace(/<[^>]*>/g, ""),
      });

      return { success: true };
    } catch (error) {
      log.error("api", "EmailService send error", { error: error instanceof Error ? error.message : String(error) });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Test the email configuration by sending a test email
   */
  async sendTestEmail(to: string): Promise<{ success: boolean; error?: string }> {
    return this.send({
      to,
      subject: "Grounded Platform - Test Email",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Email Configuration Test</h2>
          <p>This is a test email from your Grounded Platform installation.</p>
          <p>If you received this email, your SMTP configuration is working correctly.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">
            Sent at: ${new Date().toISOString()}
          </p>
        </div>
      `,
    });
  }

  /**
   * Send a tenant health alert email
   */
  async sendHealthAlert(
    recipients: string[],
    alerts: TenantHealthAlert[],
    summary: { total: number; healthy: number; withWarnings: number }
  ): Promise<{ success: boolean; error?: string }> {
    const hasIssues = alerts.length > 0;

    const flagLabels: Record<string, string> = {
      high_error_rate: "High Error Rate",
      kb_quota_warning: "KB Quota Warning",
      agent_quota_warning: "Agent Quota Warning",
      upload_quota_warning: "Upload Quota Warning",
      scrape_quota_warning: "Scrape Quota Warning",
      high_rate_limiting: "High Rate Limiting",
      low_activity: "Low Activity",
    };

    const alertRows = alerts
      .map(
        (alert) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #eee;">
            <strong>${alert.tenantName}</strong>
            <br><span style="color: #666; font-size: 12px;">${alert.tenantSlug}</span>
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">
            <span style="display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; ${
              alert.healthScore >= 70
                ? "background: #dcfce7; color: #166534;"
                : alert.healthScore >= 50
                ? "background: #fef9c3; color: #854d0e;"
                : "background: #fee2e2; color: #991b1b;"
            }">
              ${alert.healthScore}
            </span>
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
            ${alert.errorRate.toFixed(1)}%
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee;">
            ${alert.flags.map((f) => `<span style="display: inline-block; margin: 2px; padding: 2px 6px; background: #fef3c7; color: #92400e; border-radius: 4px; font-size: 11px;">${flagLabels[f] || f}</span>`).join("")}
          </td>
        </tr>
      `
      )
      .join("");

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333; margin-bottom: 20px;">
          ${hasIssues ? "Tenant Health Alert" : "Tenant Health Report"}
        </h2>

        <div style="background: ${hasIssues ? "#fef3c7" : "#dcfce7"}; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
          <p style="margin: 0; color: ${hasIssues ? "#92400e" : "#166534"};">
            <strong>Summary:</strong> ${summary.total} tenants total, ${summary.healthy} healthy, ${summary.withWarnings} with warnings
          </p>
        </div>

        ${
          hasIssues
            ? `
          <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">Tenant</th>
                <th style="padding: 12px; text-align: center; font-size: 12px; color: #6b7280; text-transform: uppercase;">Health</th>
                <th style="padding: 12px; text-align: right; font-size: 12px; color: #6b7280; text-transform: uppercase;">Error Rate</th>
                <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">Flags</th>
              </tr>
            </thead>
            <tbody>
              ${alertRows}
            </tbody>
          </table>
        `
            : `
          <p style="color: #166534;">All tenants are healthy. No issues detected.</p>
        `
        }

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0 20px;">
        <p style="color: #9ca3af; font-size: 12px;">
          This is an automated alert from your Grounded Platform.<br>
          Generated at: ${new Date().toISOString()}
        </p>
      </div>
    `;

    return this.send({
      to: recipients,
      subject: hasIssues
        ? `[Grounded Alert] ${alerts.length} tenant(s) require attention`
        : "[Grounded] Tenant Health Report - All Systems Healthy",
      html,
    });
  }

  /**
   * Send a per-tenant health alert email (for tenant owners/admins)
   */
  async sendTenantHealthAlert(
    recipients: string[],
    alert: TenantHealthAlert,
    systemDefaults: { errorRateThreshold: number; quotaWarningThreshold: number; inactivityDays: number }
  ): Promise<{ success: boolean; error?: string }> {
    const flagLabels: Record<string, string> = {
      high_error_rate: "High Error Rate",
      kb_quota_warning: "KB Quota Warning",
      agent_quota_warning: "Agent Quota Warning",
      upload_quota_warning: "Upload Quota Warning",
      scrape_quota_warning: "Scrape Quota Warning",
      high_rate_limiting: "High Rate Limiting",
      low_activity: "Low Activity",
    };

    const flagDescriptions: Record<string, string> = {
      high_error_rate: `Error rate exceeds ${systemDefaults.errorRateThreshold}% threshold`,
      kb_quota_warning: `Knowledge base count approaching ${systemDefaults.quotaWarningThreshold}% of quota`,
      agent_quota_warning: `Agent count approaching ${systemDefaults.quotaWarningThreshold}% of quota`,
      upload_quota_warning: `Monthly uploads approaching ${systemDefaults.quotaWarningThreshold}% of quota`,
      scrape_quota_warning: `Monthly scrapes approaching ${systemDefaults.quotaWarningThreshold}% of quota`,
      high_rate_limiting: "More than 5% of requests are being rate limited",
      low_activity: `No chat activity in the last ${systemDefaults.inactivityDays} days`,
    };

    const flagsList = alert.flags
      .map(
        (flag) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">
            <span style="display: inline-block; padding: 2px 8px; background: #fef3c7; color: #92400e; border-radius: 4px; font-size: 12px; font-weight: 500;">
              ${flagLabels[flag] || flag}
            </span>
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #666;">
            ${flagDescriptions[flag] || "Threshold exceeded"}
          </td>
        </tr>
      `
      )
      .join("");

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333; margin-bottom: 20px;">
          Health Alert for ${alert.tenantName}
        </h2>

        <div style="background: #fef3c7; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
          <p style="margin: 0; color: #92400e;">
            Your tenant <strong>${alert.tenantName}</strong> (${alert.tenantSlug}) has ${alert.flags.length} health warning(s) that require attention.
          </p>
        </div>

        <div style="margin-bottom: 24px;">
          <h3 style="color: #333; font-size: 14px; margin-bottom: 12px;">Health Score</h3>
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="display: inline-block; padding: 8px 16px; border-radius: 8px; font-size: 24px; font-weight: bold; ${
              alert.healthScore >= 70
                ? "background: #dcfce7; color: #166534;"
                : alert.healthScore >= 50
                ? "background: #fef9c3; color: #854d0e;"
                : "background: #fee2e2; color: #991b1b;"
            }">
              ${alert.healthScore}/100
            </span>
            <span style="color: #666;">
              ${alert.totalQueries} queries in last 24h | ${alert.errorRate.toFixed(1)}% error rate
            </span>
          </div>
        </div>

        <div style="margin-bottom: 24px;">
          <h3 style="color: #333; font-size: 14px; margin-bottom: 12px;">Issues Detected</h3>
          <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="padding: 8px 12px; text-align: left; font-size: 11px; color: #6b7280; text-transform: uppercase;">Issue</th>
                <th style="padding: 8px 12px; text-align: left; font-size: 11px; color: #6b7280; text-transform: uppercase;">Description</th>
              </tr>
            </thead>
            <tbody>
              ${flagsList}
            </tbody>
          </table>
        </div>

        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
          <h4 style="color: #333; margin: 0 0 8px 0; font-size: 13px;">Recommended Actions</h4>
          <ul style="margin: 0; padding-left: 20px; color: #666; font-size: 13px;">
            ${alert.flags.includes("high_error_rate") ? "<li>Review recent error logs to identify the cause of failures</li>" : ""}
            ${alert.flags.includes("kb_quota_warning") || alert.flags.includes("agent_quota_warning") ? "<li>Consider upgrading your plan or removing unused resources</li>" : ""}
            ${alert.flags.includes("upload_quota_warning") || alert.flags.includes("scrape_quota_warning") ? "<li>Review your monthly usage and optimize ingestion frequency</li>" : ""}
            ${alert.flags.includes("high_rate_limiting") ? "<li>Reduce request frequency or upgrade your rate limit</li>" : ""}
            ${alert.flags.includes("low_activity") ? "<li>Verify your integrations are working correctly</li>" : ""}
          </ul>
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0 20px;">
        <p style="color: #9ca3af; font-size: 12px;">
          This is an automated alert from your Grounded Platform.<br>
          You're receiving this because you're an owner or admin of ${alert.tenantName}.<br>
          To manage alert preferences, visit your tenant settings.<br><br>
          Generated at: ${new Date().toISOString()}
        </p>
      </div>
    `;

    return this.send({
      to: recipients,
      subject: `[Grounded Alert] ${alert.tenantName} - ${alert.flags.length} issue(s) detected`,
      html,
    });
  }

  /**
   * Send a test regression alert email
   */
  async sendTestRegressionAlert(
    recipients: string[],
    data: TestRegressionAlert
  ): Promise<{ success: boolean; error?: string }> {
    const dropLabel = data.passRateDrop >= 0
      ? `Drop: ${data.passRateDrop.toFixed(1)}%`
      : `Increase: ${Math.abs(data.passRateDrop).toFixed(1)}%`;
    const dropColor = data.passRateDrop >= 0 ? "#b91c1c" : "#166534";

    const newlyFailingList = data.newlyFailingCases
      .map(
        (testCase) => `
        <li style="margin-bottom: 12px;">
          <strong style="color: #111827;">${testCase.testCaseName}</strong><br>
          <span style="color: #6b7280; font-size: 13px;">${testCase.question}</span>
        </li>
      `
      )
      .join("");

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #111827; margin-bottom: 16px;">Test Suite Regression Detected</h2>

        <div style="background: #fef2f2; padding: 16px; border-radius: 10px; margin-bottom: 20px;">
          <p style="margin: 0; color: #991b1b; font-weight: 600;">A regression was detected in ${data.suiteName}.</p>
        </div>

        <table style="width: 100%; margin-bottom: 24px;">
          <tr>
            <td style="padding: 4px 0; color: #6b7280; width: 120px;">Tenant</td>
            <td style="padding: 4px 0; color: #111827;">${data.tenantName}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6b7280;">Agent</td>
            <td style="padding: 4px 0; color: #111827;">${data.agentName}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6b7280;">Test Suite</td>
            <td style="padding: 4px 0; color: #111827;">${data.suiteName}</td>
          </tr>
        </table>

        <div style="border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin-bottom: 24px;">
          <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 15px;">Pass Rate Change</h3>
          <p style="margin: 0; color: #374151;">
            Previous: <strong>${data.previousPassRate.toFixed(1)}%</strong><br>
            Current: <strong>${data.currentPassRate.toFixed(1)}%</strong><br>
            <span style="color: ${dropColor}; font-weight: 600;">${dropLabel}</span>
          </p>
        </div>

        ${
          data.newlyFailingCases.length > 0
            ? `
          <div style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 15px;">
              Newly Failing Tests (${data.newlyFailingCases.length})
            </h3>
            <ul style="margin: 0; padding-left: 20px; color: #111827;">
              ${newlyFailingList}
            </ul>
          </div>
        `
            : ""
        }

        <a href="${data.runUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 10px 16px; border-radius: 6px; font-weight: 600;">View Run Details</a>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0 16px;">
        <p style="color: #9ca3af; font-size: 12px;">
          Run ID: ${data.runId}<br>
          Generated at: ${new Date().toISOString()}
        </p>
      </div>
    `;

    return this.send({
      to: recipients,
      subject: `[Grounded] Test Regression: ${data.suiteName} for ${data.agentName}`,
      html,
    });
  }

  /**
   * Verify the SMTP connection
   */
  async verifyConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const transporter = await this.getTransporter();
      if (!transporter) {
        return { success: false, error: "Email not configured" };
      }

      await transporter.verify();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Invalidate the config cache (call when settings are updated)
   */
  invalidateCache(): void {
    this.config = null;
    this.configLoadedAt = 0;
    this.transporter = null;
  }
}

// Singleton instance
export const emailService = new EmailService();

// ============================================================================
// Alert Settings Helper
// ============================================================================

interface AlertSettings {
  enabled: boolean;
  recipientEmails: string[];
  checkIntervalMinutes: number;
  errorRateThreshold: number;
  quotaWarningThreshold: number;
  inactivityDays: number;
  includeHealthySummary: boolean;
}

export async function getAlertSettings(): Promise<AlertSettings> {
  const settings = await db.query.systemSettings.findMany({
    where: (s, { like }) => like(s.key, "alerts.%"),
  });

  const settingsMap = new Map(settings.map((s) => [s.key, JSON.parse(s.value)]));

  const recipientStr = settingsMap.get("alerts.recipient_emails") ?? "";

  return {
    enabled: settingsMap.get("alerts.enabled") ?? false,
    recipientEmails: recipientStr
      ? recipientStr.split(",").map((e: string) => e.trim()).filter(Boolean)
      : [],
    checkIntervalMinutes: settingsMap.get("alerts.check_interval_minutes") ?? 60,
    errorRateThreshold: settingsMap.get("alerts.error_rate_threshold") ?? 10,
    quotaWarningThreshold: settingsMap.get("alerts.quota_warning_threshold") ?? 80,
    inactivityDays: settingsMap.get("alerts.inactivity_days") ?? 7,
    includeHealthySummary: settingsMap.get("alerts.include_healthy_summary") ?? false,
  };
}
