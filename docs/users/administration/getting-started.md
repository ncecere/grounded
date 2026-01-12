# System Administration - Getting Started

This guide walks you through the initial setup of Grounded after deployment.

## First Login

### Default Admin Account

If you configured `ADMIN_EMAIL` and `ADMIN_PASSWORD` in your environment, an admin account is created automatically on first startup.

1. Navigate to your Grounded deployment (e.g., `https://grounded.yourdomain.com`)
2. Click **Sign In**
3. Enter your admin credentials
4. You'll be logged in with system administrator privileges

### Creating Admin Account Manually

If you didn't set admin credentials in environment variables:

1. Navigate to your Grounded deployment
2. Click **Register** to create an account
3. After registration, use the database to grant admin rights:

```sql
-- Connect to your database
psql $DATABASE_URL

-- Find your user ID
SELECT id, email FROM users WHERE email = 'your@email.com';

-- Grant system admin
INSERT INTO system_admins (user_id) VALUES ('your-user-id');
```

## Admin Dashboard Overview

After logging in as a system admin, you'll see the admin navigation in the sidebar:

| Section | Purpose |
|---------|---------|
| **Dashboard** | System health and overview metrics |
| **Analytics** | Platform-wide usage statistics |
| **Tenants** | Manage organizations |
| **Users** | Manage user accounts |
| **Shared KBs** | Global knowledge bases |
| **AI Models** | Configure LLM providers |
| **Settings** | System configuration |

## Initial Setup Checklist

### 1. Configure AI Models

Before users can chat, you need to configure at least one LLM provider.

**Navigate to:** Settings > AI Models

**Add a Provider:**

1. Click **Add Provider**
2. Select provider type:
   - **OpenAI** - GPT-4, GPT-3.5, embeddings
   - **Anthropic** - Claude models
   - **Google AI** - Gemini models
   - **OpenAI-Compatible** - Custom endpoints
3. Enter your API key
4. Give it a display name
5. Click **Save**

**Add Models:**

1. Click **Add Model** under your provider
2. Configure the model:
   - **Model ID**: The provider's model name (e.g., `gpt-4o`)
   - **Display Name**: Friendly name for users
   - **Capabilities**: Chat, Embeddings, Tool Use
   - **Context Window**: Maximum tokens
   - **Temperature**: Default creativity level
3. Mark one model as **Default** for chat
4. Mark one embedding model as **Default** for embeddings

**Recommended Initial Setup:**

| Provider | Model | Purpose |
|----------|-------|---------|
| OpenAI | `gpt-4o` | Default chat model |
| OpenAI | `text-embedding-3-small` | Default embeddings |

### 2. Review System Settings

**Navigate to:** Settings

Review and configure:

**Authentication:**
- Enable/disable local registration
- Configure OIDC if using SSO

**Quotas:**
- Set default limits for new tenants
- Adjust based on your capacity

**Health Checks:**
- Configure alert email
- Set latency thresholds

### 3. Create Your First Tenant

**Navigate to:** Tenants > Create Tenant

1. Enter tenant name (e.g., "My Company")
2. Add the owner's email
3. Click **Create**

The owner will receive access to their new tenant.

### 4. Verify System Health

**Navigate to:** Dashboard

Check that all components show healthy status:

- ✅ Database connection
- ✅ Vector store connection
- ✅ Redis connection
- ✅ LLM provider connectivity

If any component shows unhealthy, check the logs and configuration.

## Quick Configuration Walkthrough

### Setting Up OpenAI

1. Get an API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Go to **AI Models** > **Add Provider**
3. Select **OpenAI**
4. Enter your API key
5. Click **Add Model**:
   - Model ID: `gpt-4o`
   - Display Name: `GPT-4o`
   - Capabilities: Chat, Tool Use
   - Set as Default: ✅
6. Click **Add Model** again:
   - Model ID: `text-embedding-3-small`
   - Display Name: `Embeddings (Small)`
   - Capabilities: Embeddings
   - Set as Default: ✅

### Setting Up Anthropic

1. Get an API key from [Anthropic Console](https://console.anthropic.com/)
2. Go to **AI Models** > **Add Provider**
3. Select **Anthropic**
4. Enter your API key
5. Click **Add Model**:
   - Model ID: `claude-sonnet-4-20250514`
   - Display Name: `Claude Sonnet`
   - Capabilities: Chat, Tool Use
   - Set as Default (if primary): ✅

### Setting Up SSO (OIDC)

1. Configure your identity provider:
   - Create a new OIDC application
   - Set callback URL: `https://grounded.yourdomain.com/api/v1/auth/oidc/callback`
   - Note the client ID and secret

2. Set environment variables:
   ```env
   OIDC_ISSUER_URL=https://your-idp.com
   OIDC_CLIENT_ID=your-client-id
   OIDC_CLIENT_SECRET=your-secret
   OIDC_REDIRECT_URI=https://grounded.yourdomain.com/api/v1/auth/oidc/callback
   ```

3. Restart the API service

4. Go to **Settings** > Enable OIDC authentication

5. Optionally disable local registration

## Creating Your Organization Structure

### Single-Tenant Setup

For small teams or single organizations:

1. Create one tenant for your organization
2. Add all users as members
3. Create knowledge bases and agents

### Multi-Tenant Setup

For multiple departments or customers:

1. Create a tenant for each organization
2. Assign owners to manage their tenants
3. Consider using shared knowledge bases for common content

### Enterprise Setup

For large organizations:

1. Configure OIDC for centralized authentication
2. Create tenants for departments/teams
3. Set up shared knowledge bases for company-wide content
4. Configure quotas based on department size
5. Enable health monitoring and alerts

## Next Steps

After initial setup:

1. **[Model Configuration](./model-configuration.md)** - Deep dive into AI model setup
2. **[User Management](./user-management.md)** - Managing users and access
3. **[Tenant Management](./tenant-management.md)** - Working with tenants
4. **[System Settings](./system-settings.md)** - All configuration options

---

Next: [User Management](./user-management.md)
