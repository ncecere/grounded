# System Settings

This guide covers the system-wide configuration settings available to administrators.

## Overview

System settings control platform-wide behavior for authentication, resource quotas, email notifications, alerts, and API access. Access these settings by navigating to **Settings** in the Admin section of the sidebar.

![Settings Overview](./assets/settings-overview.png)

## Authentication Settings

The Authentication tab configures how users sign in to the platform.

![Authentication Settings](./assets/settings-authentication.png)

### Local Authentication

| Setting | Description | Default |
|---------|-------------|---------|
| **Local Registration Enabled** | Allow users to register with email/password | `true` |

When enabled, users can create accounts using the registration form. Disable this to require OIDC authentication or manual user creation.

### OIDC (Single Sign-On)

| Setting | Description | Default |
|---------|-------------|---------|
| **OIDC Enabled** | Enable OIDC authentication | `false` |
| **OIDC Issuer** | The OIDC provider URL (e.g., `https://auth.example.com`) | - |
| **OIDC Client ID** | Application client ID from your OIDC provider | - |
| **OIDC Client Secret** | Application client secret (stored securely) | - |

**Supported Providers:**
- Auth0
- Okta
- Keycloak
- Azure AD
- Google Workspace
- Any OIDC-compliant provider

**Setup Steps:**
1. Create an application in your OIDC provider
2. Set the callback URL to `https://your-domain/api/v1/auth/oidc/callback`
3. Copy the issuer URL, client ID, and client secret
4. Enter these values in the settings
5. Enable OIDC

## Quotas Settings

The Quotas tab sets default resource limits for new tenants.

![Quotas Settings](./assets/settings-quotas.png)

| Setting | Description | Default |
|---------|-------------|---------|
| **Max Knowledge Bases** | Maximum knowledge bases per tenant | `10` |
| **Max Agents** | Maximum agents per tenant | `10` |
| **Max Uploaded Documents** | Monthly document upload limit | `1000` |
| **Max Scraped Pages** | Monthly web scraping limit | `1000` |
| **Chat Rate Limit** | Maximum chat requests per minute | `60` |

**Notes:**
- These are **default** values for newly created tenants
- Existing tenants are not affected by changes here
- Individual tenant quotas can be overridden in Tenant Management
- Set `0` for unlimited (use with caution)

### Quota Planning

| Tenant Size | Knowledge Bases | Agents | Uploads/Month | Scrapes/Month |
|-------------|-----------------|--------|---------------|---------------|
| Small | 5 | 5 | 500 | 500 |
| Medium | 10 | 10 | 2,000 | 2,000 |
| Large | 25 | 25 | 10,000 | 10,000 |
| Enterprise | Unlimited | Unlimited | Unlimited | Unlimited |

## Email (SMTP) Settings

The Email tab configures outbound email for notifications and alerts.

![Email Settings](./assets/settings-email.png)

### SMTP Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| **SMTP Enabled** | Enable email sending | `false` |
| **SMTP Host** | Mail server hostname | - |
| **SMTP Port** | Mail server port | `587` |
| **SMTP Secure** | Use SSL/TLS encryption | `false` |
| **SMTP User** | Authentication username | - |
| **SMTP Password** | Authentication password | - |
| **From Address** | Sender email address | - |
| **From Name** | Sender display name | `Grounded Platform` |

### Common SMTP Configurations

**Gmail/Google Workspace:**
```
Host: smtp.gmail.com
Port: 587
Secure: false (uses STARTTLS)
User: your-email@gmail.com
Password: App Password (not regular password)
```

**Amazon SES:**
```
Host: email-smtp.us-east-1.amazonaws.com
Port: 587
Secure: false
User: SMTP credentials (from SES console)
Password: SMTP password
```

**SendGrid:**
```
Host: smtp.sendgrid.net
Port: 587
Secure: false
User: apikey
Password: your-api-key
```

### Testing Email

1. Configure all SMTP settings
2. Click **Verify Connection** to test connectivity
3. Enter a test email address
4. Click **Send Test Email**
5. Check your inbox for the test message

**Troubleshooting:**
- **Connection refused**: Check host and port
- **Authentication failed**: Verify username/password
- **TLS errors**: Try toggling the Secure setting
- **Timeout**: Check firewall rules

## Alerts Settings

The Alerts tab configures automated health monitoring notifications.

![Alerts Settings](./assets/settings-alerts.png)

| Setting | Description | Default |
|---------|-------------|---------|
| **Alerts Enabled** | Enable automated health alerts | `false` |
| **Recipient Emails** | Comma-separated list of alert recipients | - |
| **Check Interval (minutes)** | How often to check health metrics | `60` |
| **Error Rate Threshold (%)** | Alert when error rate exceeds this percentage | `10` |
| **Quota Warning Threshold (%)** | Alert when quota usage exceeds this percentage | `80` |
| **Inactivity Days** | Alert after this many days of tenant inactivity | `7` |
| **Include Healthy Summary** | Send summary even when all tenants are healthy | `false` |

### Alert Types

**Error Rate Alert:**
Triggered when a tenant's chat error rate exceeds the threshold. Common causes:
- Model API errors
- Embedding failures
- Rate limiting

**Quota Warning:**
Triggered when a tenant approaches their usage limits. Helps you proactively upgrade quotas before users are blocked.

**Inactivity Alert:**
Triggered when a tenant has no activity for the specified number of days. Useful for identifying abandoned tenants or engagement issues.

### Prerequisites

Email alerts require SMTP to be configured and working. Set up Email settings first.

### Recommended Configuration

| Environment | Check Interval | Error Threshold | Quota Threshold |
|-------------|---------------|-----------------|-----------------|
| Development | 1440 (daily) | 25% | 90% |
| Staging | 60 (hourly) | 15% | 80% |
| Production | 15 (frequent) | 10% | 75% |

## Workers Settings

The Workers tab configures background job processing. See [Worker Settings](./worker-settings.md) for detailed documentation.

## API Tokens

The API Tokens tab manages administrative API tokens for automation.

![API Tokens](./assets/settings-api-tokens.png)

### Creating a Token

1. Click **Create Token**
2. Enter a descriptive name (e.g., "CI/CD Pipeline", "Monitoring Script")
3. Optionally set an expiration date
4. Click **Create Token**

![Create Token Dialog](./assets/settings-create-token.png)

5. **Copy the token immediately** - it won't be shown again

![Token Created](./assets/settings-token-created.png)

### Token Format

Admin tokens are prefixed with `grounded_admin_` followed by a secure random string:
```
grounded_admin_a1b2c3d4e5f6...
```

### Using Tokens

Include the token in the `Authorization` header:

```bash
curl -X GET https://your-domain/api/v1/admin/tenants \
  -H "Authorization: Bearer grounded_admin_your_token_here"
```

### Token Management

![API Tokens List](./assets/settings-api-tokens-list.png)

The token list shows:
- **Name**: Token description
- **Created**: When the token was created
- **Last Used**: Most recent API call (helps identify unused tokens)
- **Expires**: Expiration date (if set)

### Revoking Tokens

1. Find the token in the list
2. Click **Revoke**
3. Confirm the action

Revoked tokens are immediately invalidated. Any automation using that token will fail.

### Security Best Practices

1. **Use descriptive names**: Make it clear what each token is for
2. **Set expiration dates**: Especially for temporary access
3. **Rotate regularly**: Replace tokens periodically
4. **Monitor usage**: Check "Last Used" to identify stale tokens
5. **Revoke unused tokens**: Remove tokens that are no longer needed
6. **One token per use case**: Don't share tokens across systems

### Use Cases

| Use Case | Expiration | Notes |
|----------|------------|-------|
| CI/CD Pipeline | 90 days | Rotate during deployments |
| Monitoring | 1 year | Long-lived, read-only operations |
| One-time Script | 1 day | Short expiration for safety |
| Development | 7 days | Frequent rotation during dev |

## API Reference

### Get All Settings

```bash
GET /api/v1/admin/settings
Authorization: Bearer <token>
```

### Update a Setting

```bash
PUT /api/v1/admin/settings/:key
Authorization: Bearer <token>
Content-Type: application/json

{
  "value": "new_value"
}
```

### Settings Keys

| Category | Key | Type |
|----------|-----|------|
| Auth | `auth.local_registration_enabled` | boolean |
| Auth | `auth.oidc_enabled` | boolean |
| Auth | `auth.oidc_issuer` | string |
| Auth | `auth.oidc_client_id` | string |
| Auth | `auth.oidc_client_secret` | string (secret) |
| Quotas | `quotas.default_max_kbs` | number |
| Quotas | `quotas.default_max_agents` | number |
| Quotas | `quotas.default_max_uploaded_docs` | number |
| Quotas | `quotas.default_max_scraped_pages` | number |
| Quotas | `quotas.default_chat_rate_limit` | number |
| Email | `email.smtp_enabled` | boolean |
| Email | `email.smtp_host` | string |
| Email | `email.smtp_port` | number |
| Email | `email.smtp_secure` | boolean |
| Email | `email.smtp_user` | string |
| Email | `email.smtp_password` | string (secret) |
| Email | `email.from_address` | string |
| Email | `email.from_name` | string |
| Alerts | `alerts.enabled` | boolean |
| Alerts | `alerts.recipient_emails` | string |
| Alerts | `alerts.check_interval_minutes` | number |
| Alerts | `alerts.error_rate_threshold` | number |
| Alerts | `alerts.quota_warning_threshold` | number |
| Alerts | `alerts.inactivity_days` | number |
| Alerts | `alerts.include_healthy_summary` | boolean |
| Workers | `workers.fairness_enabled` | boolean |
| Workers | `workers.fairness_total_slots` | number |
| Workers | `workers.fairness_min_slots_per_run` | number |
| Workers | `workers.fairness_max_slots_per_run` | number |
| Workers | `workers.fairness_retry_delay_ms` | number |
| Workers | `workers.scraper_concurrency` | number |
| Workers | `workers.ingestion_concurrency` | number |
| Workers | `workers.embed_concurrency` | number |

---

Next: [Worker Settings](./worker-settings.md) | [Model Configuration](./model-configuration.md)
