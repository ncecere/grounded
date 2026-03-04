# System Settings

System Settings control global configuration for your Grounded instance. This is a **system admin** function.

## Accessing Settings

From the Admin Panel, click **Settings** in the sidebar. Settings are organized into six tabs.

---

## Authentication Tab

Controls how users log in to Grounded.

![Authentication Settings](./screenshots/admin-settings-auth-full.png)

| Setting | What It Does | When to Change |
|---------|-------------|----------------|
| **Session Secret** | Secret key used to sign login tokens (JWT). Must be at least 32 characters. | Set once during installation. Change if compromised. |
| **OIDC Issuer** | URL of your identity provider (e.g., `https://login.company.com`) | Set up SSO/OIDC authentication |
| **OIDC Client ID** | OAuth client ID from your identity provider | Set up SSO/OIDC authentication |
| **OIDC Client Secret** | OAuth client secret from your identity provider | Set up SSO/OIDC authentication |
| **OIDC Redirect URI** | Callback URL after authentication (e.g., `https://grounded.company.com/api/v1/auth/oidc/callback`) | Set up SSO/OIDC authentication |

### OIDC Setup Guide

To enable Single Sign-On:
1. Register Grounded as an application in your identity provider (Okta, Auth0, Azure AD, etc.)
2. Get the **Client ID** and **Client Secret**
3. Note the **Issuer URL** (usually something like `https://your-company.okta.com`)
4. Set the **Redirect URI** in both your identity provider and Grounded
5. Save settings
6. Test by logging out and trying to log in via SSO

> ⚠️ **Caution:** Changing auth settings incorrectly can lock everyone out. Always test in an incognito window first, and keep a local admin password as backup.

---

## Quotas Tab

Sets default resource limits for all tenants. These prevent any single tenant from consuming excessive resources.

![Quotas Settings](./screenshots/admin-settings-quotas-full.png)

| Setting | What It Controls | Default | When to Increase |
|---------|-----------------|---------|-----------------|
| **Max KBs per tenant** | How many knowledge bases a tenant can create | 10 | Large organizations with many content areas |
| **Max agents per tenant** | How many AI agents a tenant can configure | 10 | Teams with many distinct use cases |
| **Max uploaded docs/month** | Monthly file upload limit | 1,000 | Heavy document upload workflows |
| **Max scraped pages/month** | Monthly web scraping limit | 1,000 | Large websites being scraped frequently |
| **Max crawl concurrency** | Concurrent page fetches per tenant | 5 | Faster crawls needed (increases server load) |
| **Chat rate limit/minute** | Chat requests per minute per tenant | 60 | High-traffic widget deployments |

### How Quotas Work
- These are **defaults** applied to all tenants
- Individual tenants can have custom quotas (override via tenant management)
- When a limit is reached, the user sees a clear error message
- Quota usage resets monthly (except concurrency, which is real-time)
- Usage is tracked in the **tenant_usage** table

### Sizing Guidelines

| Deployment Size | KBs | Agents | Docs/mo | Pages/mo | Chat/min |
|-----------------|-----|--------|---------|----------|----------|
| Small (< 5 users) | 5 | 5 | 100 | 500 | 30 |
| Medium (5-50 users) | 10 | 10 | 1,000 | 1,000 | 60 |
| Large (50+ users) | 50 | 50 | 10,000 | 10,000 | 300 |

---

## Email (SMTP) Tab

Configures the email server for sending notifications and alerts.

![Email Settings](./screenshots/admin-settings-email-full.png)

| Setting | Description | Example |
|---------|-------------|---------|
| **Enabled** | Turn email sending on/off globally | `true` |
| **SMTP Host** | Email server hostname | `smtp.gmail.com`, `email-smtp.us-east-1.amazonaws.com` |
| **SMTP Port** | Server port | `587` (TLS) or `465` (SSL) |
| **SMTP Secure** | Use SSL/TLS encryption | `true` for port 465, `false` for port 587 with STARTTLS |
| **SMTP User** | Authentication username | `alerts@company.com` or AWS SES access key |
| **SMTP Password** | Authentication password | App password or SES secret key |
| **From Address** | Sender email address | `grounded@company.com` |
| **From Name** | Sender display name | `Grounded Alerts` |

### Common SMTP Configurations

**Gmail (for testing):**
```
Host: smtp.gmail.com
Port: 587
Secure: false
User: your-email@gmail.com
Password: (use App Password, not your regular password)
```

**Amazon SES:**
```
Host: email-smtp.us-east-1.amazonaws.com
Port: 587
Secure: false
User: (SES SMTP username)
Password: (SES SMTP password)
```

**SendGrid:**
```
Host: smtp.sendgrid.net
Port: 587
Secure: false
User: apikey
Password: (your SendGrid API key)
```

### Testing Email

After configuring SMTP, click **Send Test Email** to verify:
- ✅ Email received = configuration is correct
- ❌ Error = check credentials, host, port, and network access

> **Note:** Email must be configured for alert notifications, test regression alerts, and health alerts to work.

---

## Alerts Tab

Configures system-wide default thresholds for alert notifications.

![Alerts Settings](./screenshots/admin-settings-alerts-full.png)

| Setting | What It Monitors | Default | What Triggers an Alert |
|---------|-----------------|---------|----------------------|
| **Error rate threshold (%)** | Chat error rate per tenant | 10% | More than 10% of chat requests fail in a period |
| **Quota warning threshold (%)** | Resource usage vs. limits | 80% | Tenant uses more than 80% of any quota |
| **Inactivity days** | Days since last activity | 14 | No chat or ingestion activity for 14 days |

### How Alerts Work
1. The system periodically checks tenant health metrics
2. When a threshold is exceeded, an alert email is sent
3. Recipients are determined by each tenant's alert settings (owners, admins, custom emails)
4. These are **default** thresholds — tenants can override them in their Settings

### Alert Types Sent

| Alert | When | Who Gets It |
|-------|------|-------------|
| **High Error Rate** | Chat error rate exceeds threshold | Tenant owners/admins |
| **Quota Warning** | Usage approaching limits | Tenant owners/admins |
| **Inactivity** | No activity for configured days | Tenant owners/admins |
| **Test Regression** | Test suite pass rate drops | Tenant owners/admins |

---

## Workers Tab

Configures background processing workers that handle web scraping, content processing, and embedding generation.

![Workers Settings](./screenshots/admin-settings-workers-full.png)

### Concurrency Settings

These control how many jobs each worker processes simultaneously:

| Setting | What It Controls | Default | Effect of Increasing |
|---------|-----------------|---------|---------------------|
| **Scraper concurrency** | Concurrent page fetch jobs | 5 | Faster scraping but more CPU/memory |
| **Ingestion concurrency** | Concurrent content processing jobs | 5 | Faster chunking/indexing |
| **Embed concurrency** | Concurrent embedding API calls | 4 | Faster embedding but may hit API rate limits |

> **Note:** Concurrency changes require a **worker restart** to fully apply. Other settings take effect within 60 seconds.

### Fairness Scheduler

The fairness scheduler prevents any single ingestion run from monopolizing worker capacity when multiple runs are active:

| Setting | What It Does | Default | When to Change |
|---------|-------------|---------|----------------|
| **Fairness enabled** | Turn fair scheduling on/off | Enabled | Disable only if you have one tenant with one source |
| **Total slots** | Total worker capacity to distribute | 5 | Match to your scraper concurrency |
| **Min slots per run** | Minimum guaranteed capacity per run | 1 | Increase if small runs are too slow |
| **Max slots per run** | Maximum capacity any single run can use | 10 | Decrease if one large crawl blocks others |
| **Retry delay (ms)** | How long to wait when no slot available | 500 | Increase for busy systems |

**Example:** With 10 total slots and 3 active runs:
- Each run gets ~3 slots (fair share)
- Min ensures no run gets less than 1 slot
- Max prevents any run from taking more than 10 slots

### Embedding Settings

| Setting | What It Does | Default |
|---------|-------------|---------|
| **Batch size** | Texts per embedding API call | 100 |
| **Parallel batches** | Concurrent embedding API calls per job | 3 |

Larger batches are more efficient but use more memory. More parallel batches speed up embedding but may hit provider rate limits.

---

## API Tokens Tab

Manage system-level admin API tokens for programmatic access to admin functions.

![API Tokens](./screenshots/admin-settings-tokens-full.png)

### Creating a Token

1. Click **Create Token**
2. Enter a **name** (for identification, e.g., "CI/CD Pipeline", "Monitoring Script")
3. Optionally set an **expiration date**
4. Click **Create**
5. **Copy the token immediately** — it will never be shown again

### Token Format
```
grounded_admin_xxxxxxxxxxxxxxxxxxxxxxxx
```

### Using Admin Tokens

Include in API requests as a Bearer token:
```bash
curl -H "Authorization: Bearer grounded_admin_xxxxx..." \
     https://grounded.company.com/api/v1/admin/settings
```

Admin tokens have **full system admin access** — they can:
- Manage all tenants and users
- Change system settings
- Configure AI models
- View audit logs

### Revoking Tokens

Click **Revoke** next to any token to immediately disable it. Revoked tokens cannot be reactivated — create a new one if needed.

### Security Best Practices
- **Never share tokens** — Treat them like passwords
- **Set expiration dates** — Especially for temporary automation
- **Use descriptive names** — So you know what each token is for
- **Revoke unused tokens** — Remove tokens that are no longer needed
- **Monitor audit logs** — Admin token usage is logged

---

## Tips

- **Set up in this order:** Email first → Alerts → Quotas → Workers
- **Test email immediately** — Many features depend on working email
- **Start with defaults** — The default quotas and worker settings work well for most deployments
- **Increase gradually** — When increasing concurrency, monitor CPU and memory
- **Document your changes** — Note why you changed a setting for future reference
- **Keep a local admin backup** — Always maintain a local admin password in case OIDC fails
