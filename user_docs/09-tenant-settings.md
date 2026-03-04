# Tenant Settings

Tenant Settings let you manage your organization's team members, API access, and alert preferences. Only **Owners** and **Admins** can access these settings.

## Accessing Settings

Click **Settings** in the workspace sidebar.

The page has three tabs: **Team Members**, **Alert Settings**, and **API Keys**.

---

## Team Members Tab

Manage who has access to your tenant and what they can do:

![Team Members](./screenshots/tenant-settings-team-full.png)

### Adding a Member

1. Enter the user's **email address** (they must already have a Grounded account)
2. Select a **role** from the dropdown
3. Click **Add**

If the user doesn't have a Grounded account yet, ask your system admin to create one first.

### Roles Explained

Grounded has four tenant roles, each with increasing permissions:

| Permission | Viewer | Member | Admin | Owner |
|-----------|:------:|:------:|:-----:|:-----:|
| **View knowledge bases** | ✅ | ✅ | ✅ | ✅ |
| **Chat with agents** | ❌ | ✅ | ✅ | ✅ |
| **View analytics** | ❌ | ✅ | ✅ | ✅ |
| **Create/edit KBs** | ❌ | ❌ | ✅ | ✅ |
| **Create/edit agents** | ❌ | ❌ | ✅ | ✅ |
| **Add/run sources** | ❌ | ❌ | ✅ | ✅ |
| **Manage test suites** | ❌ | ❌ | ✅ | ✅ |
| **Manage team members** | ❌ | ❌ | ✅ | ✅ |
| **Manage API keys** | ❌ | ❌ | ✅ | ✅ |
| **Change tenant settings** | ❌ | ❌ | ✅ | ✅ |
| **Delete the tenant** | ❌ | ❌ | ❌ | ✅ |
| **Transfer ownership** | ❌ | ❌ | ❌ | ✅ |

### Choosing the Right Role

| Role | Best For |
|------|---------|
| **Owner** | Primary account holder, project lead. Only one recommended per tenant. |
| **Admin** | Team leads, content managers who need to configure KBs and agents |
| **Member** | Regular users who chat with agents and view analytics |
| **Viewer** | Stakeholders who need read-only visibility (e.g., executives, auditors) |

### Changing a Member's Role

Use the **role dropdown** next to any member to change their role:
- Changes take effect immediately
- You cannot change your own role
- Owners can demote admins; admins cannot demote owners

### Removing a Member

Click **Remove member** next to a user:
- Their access to this tenant is revoked immediately
- Their Grounded account still exists (they can access other tenants)
- This does not delete any content they created

---

## API Keys Tab

Create API keys for programmatic access to your tenant's resources:

![API Keys](./screenshots/tenant-settings-apikeys-full.png)

### Creating an API Key

1. Click **Create API Key**
2. Enter a **name** — descriptive, so you know what it's used for:
   - `"Production Backend"` — for your app's server
   - `"Monitoring Script"` — for health checks
   - `"CI/CD Pipeline"` — for automated testing
3. Optionally set an **expiration date**
4. Click **Create**
5. **Copy the key immediately** — it will never be shown again!

### API Key Format
```
grounded_tenant_xxxxxxxxxxxxxxxxxxxxxxxx
```

### Using API Keys

Include in API requests with your tenant ID:
```bash
curl -X POST https://grounded.company.com/api/v1/chat \
  -H "Authorization: Bearer grounded_tenant_xxxxx..." \
  -H "X-Tenant-ID: your-tenant-id" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "agent-uuid", "message": "Hello"}'
```

### What API Keys Can Access

Tenant API keys provide access scoped to your tenant:
- Send chat messages to agents
- Read knowledge bases and agents
- View analytics data
- They **cannot** access admin functions or other tenants

### Revoking Keys

Click **Revoke** next to any key:
- The key is immediately disabled
- Any application using that key will start getting `401 Unauthorized` errors
- You cannot un-revoke — create a new key instead

### API Key Best Practices

| Practice | Why |
|----------|-----|
| **One key per integration** | If one is compromised, revoke only that one |
| **Set expiration dates** | Temporary integrations (demos, tests) should expire |
| **Use descriptive names** | You'll have multiple keys — names help identify them |
| **Rotate periodically** | Create a new key, update your app, then revoke the old one |
| **Never commit to git** | Use environment variables or secret managers |

---

## Alert Settings Tab

Configure email notifications so your team is alerted to issues:

![Alert Settings](./screenshots/tenant-settings-alerts-full.png)

### Alert Types

| Alert | What Triggers It | Default Threshold |
|-------|-----------------|-------------------|
| **Error Rate** | Chat error rate exceeds threshold | 10% |
| **Quota Warning** | Resource usage approaching limits | 80% of limit |
| **Inactivity** | No chat or ingestion activity | 14 days |
| **Test Regression** | Test suite pass rate drops | Any drop |

### Configuring Alerts

| Setting | Description | Example |
|---------|-------------|---------|
| **Enable Alerts** | Master toggle for all alerts | On/Off |
| **Notify Owners** | Send alerts to all tenant owners | ✅ Recommended |
| **Notify Admins** | Also send alerts to all admins | ✅ For production |
| **Additional Emails** | Extra recipients (comma-separated) | `ops@company.com, oncall@company.com` |
| **Error Rate Threshold** | Override the system default | 5% (stricter than default 10%) |
| **Quota Threshold** | When to warn about approaching limits | 80% |
| **Inactivity Days** | Days of silence before alerting | 7 days |

### Alert Prerequisites

For alerts to work, your system admin must:
1. ✅ Configure SMTP email settings (Admin → Settings → Email)
2. ✅ Enable the alert system (Admin → Settings → Alerts)

If you're not receiving expected alerts, check with your admin that email is configured.

### When to Customize Thresholds

| Scenario | Recommended Override |
|----------|---------------------|
| **Production-critical agent** | Lower error rate threshold (e.g., 5%) |
| **High-traffic widget** | Lower error rate, lower quota warning (70%) |
| **Development/staging tenant** | Higher thresholds or disable alerts entirely |
| **Agent with scheduled updates** | Increase inactivity days to avoid false alarms |

---

## Tips

- **Set up roles first** — Before inviting your team, decide on a role structure
- **Use the principle of least privilege** — Start with Member role, promote to Admin only when needed
- **Create API keys before building integrations** — Test the API with the key before coding against it
- **Enable alerts for production** — Don't wait for the first outage to set up notifications
- **Review team membership regularly** — Remove users who have left the team
- **Name everything descriptively** — API keys, team member notes — clear names save confusion later
