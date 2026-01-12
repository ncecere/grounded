# Tenant Management

This guide covers managing tenants (organizations) as a system administrator.

## Understanding Tenants

### What is a Tenant?

A tenant is an isolated organization within Grounded. Each tenant has:
- Its own knowledge bases and agents
- Separate user memberships
- Independent usage quotas
- Isolated data (enforced by row-level security)

### Tenant Isolation

Data isolation is enforced at multiple levels:

1. **Database**: Row-level security policies
2. **API**: Tenant ID validation on every request
3. **UI**: Tenant switcher limits visible data

This ensures that tenants cannot access each other's data.

## Viewing Tenants

**Navigate to:** Administration > Tenants

The tenant list shows:
- Tenant name
- Owner email
- Member count
- Knowledge base count
- Agent count
- Creation date

### Tenant Details

Click a tenant to view:

- **Overview**: Basic information and statistics
- **Members**: User memberships and roles
- **Quotas**: Usage limits and current usage
- **Settings**: Tenant configuration

## Creating Tenants

### From Admin Panel

1. Go to **Tenants** > **Create Tenant**
2. Enter:
   - **Name**: Organization name
   - **Owner Email**: Email of initial owner
3. Click **Create**

If the owner email exists:
- User is added as tenant owner
- User can immediately access the tenant

If the owner email is new:
- Invitation is pending
- User becomes owner when they register

### Via API

```bash
POST /api/v1/tenants
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "name": "Acme Corporation",
  "ownerEmail": "owner@acme.com"
}
```

## Managing Tenant Members

### Roles

| Role | Permissions |
|------|-------------|
| **Owner** | Full control, can delete tenant, manage billing |
| **Admin** | Manage team, KB, agents, settings |
| **Member** | Create and manage own content |
| **Viewer** | Read-only access |

### Adding Members

1. Open tenant details
2. Go to **Members** tab
3. Click **Add Member**
4. Enter email and select role
5. Click **Add**

### Changing Roles

1. Find the member
2. Click **Change Role**
3. Select new role
4. Click **Save**

### Removing Members

1. Find the member
2. Click **Remove**
3. Confirm removal

**Note:** Owners cannot be removed. To change owner:
1. Add new owner
2. Demote old owner to admin
3. Remove if needed

## Quota Management

### Default Quotas

New tenants receive default quotas (configured in System Settings):

| Quota | Default |
|-------|---------|
| Max Knowledge Bases | 10 |
| Max Agents | 5 |
| Monthly Uploads | 100 |
| Monthly Crawls | 50 |
| Chat Rate Limit | 60/min |

### Viewing Quota Usage

1. Open tenant details
2. Go to **Quotas** tab
3. See current usage vs limits

### Adjusting Quotas

To give a tenant more (or fewer) resources:

1. Open tenant details
2. Go to **Quotas** tab
3. Click **Edit Quotas**
4. Adjust limits
5. Click **Save**

**Example overrides:**

```json
{
  "maxKnowledgeBases": 25,
  "maxAgents": 10,
  "maxMonthlyUploads": 500,
  "maxMonthlyCrawls": 200,
  "chatRateLimitPerMinute": 120
}
```

### Quota Warnings

Tenants receive warnings when approaching limits:
- Warning at 80% (configurable)
- Blocked at 100%

Configure warning thresholds in System Settings.

## Tenant Settings

### Alert Configuration

Configure health alerts for the tenant:

1. Open tenant details
2. Go to **Settings** tab
3. Configure:
   - Enable/disable alerts
   - Alert recipients
   - Thresholds

### Data Retention

Soft-deleted items are retained for 30 days before permanent deletion.

To view deleted items:
1. Open tenant details
2. Go to **Deleted Items**
3. Restore or permanently delete

## Shared Knowledge Bases

Tenants can access shared knowledge bases:

### Published KBs

Global KBs marked as "published" are visible to all tenants automatically.

### Shared with Specific Tenants

To share a KB with specific tenants:

1. Go to **Shared KBs**
2. Find the knowledge base
3. Click **Share**
4. Select target tenants
5. Click **Save**

### Tenant Access

Shared KBs appear in the tenant's KB list with a "shared" indicator. Tenants can:
- Read content
- Attach to agents
- **Cannot** modify content

## Deleting Tenants

**Warning:** Tenant deletion is permanent and removes all tenant data.

### Soft Delete

By default, deletion is soft (recoverable for 30 days):

1. Open tenant details
2. Click **Delete Tenant**
3. Type tenant name to confirm
4. Click **Delete**

Soft-deleted tenants:
- Are hidden from lists
- Data is preserved
- Can be restored within 30 days

### Restore Deleted Tenant

1. Enable "Show Deleted" filter
2. Find the tenant
3. Click **Restore**

### Permanent Delete

After 30 days, soft-deleted tenants are permanently removed by the cleanup job.

For immediate permanent deletion:
1. Find the soft-deleted tenant
2. Click **Permanently Delete**
3. Confirm (this cannot be undone)

## Monitoring Tenants

### Usage Analytics

View tenant-level analytics:

1. Go to **Analytics**
2. Filter by tenant
3. See:
   - Chat volume
   - Response times
   - Error rates
   - Token usage

### Health Status

Monitor tenant health:

1. Go to **Dashboard**
2. View system-wide metrics
3. Click tenant for details

### Alerts

Configure alerts for:
- High error rates
- Quota approaching limit
- Inactivity (no usage)

## Bulk Operations

### Export Tenant List

1. Go to **Tenants**
2. Click **Export**
3. Download CSV

### Bulk Quota Update

Use the API for bulk updates:

```bash
# Update multiple tenants
for tenant_id in tenant1 tenant2 tenant3; do
  curl -X PUT "https://grounded.yourdomain.com/api/v1/tenants/$tenant_id/quotas" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"maxKnowledgeBases": 20}'
done
```

## Best Practices

### Naming Conventions

- Use clear, descriptive tenant names
- Include organization/department identifiers
- Example: "Acme Corp - Engineering"

### Quota Planning

- Start with conservative limits
- Monitor usage patterns
- Increase as needed

### Owner Management

- Ensure each tenant has an active owner
- Set up backup admins
- Document ownership changes

### Regular Audits

- Review tenant list quarterly
- Check for inactive tenants
- Verify quota allocations

## API Reference

### List Tenants

```bash
GET /api/v1/tenants
Authorization: Bearer <admin-token>
```

### Get Tenant

```bash
GET /api/v1/tenants/{tenantId}
Authorization: Bearer <admin-token>
```

### Create Tenant

```bash
POST /api/v1/tenants
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "name": "Tenant Name",
  "ownerEmail": "owner@example.com"
}
```

### Update Tenant

```bash
PUT /api/v1/tenants/{tenantId}
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "name": "New Name"
}
```

### Update Quotas

```bash
PUT /api/v1/tenants/{tenantId}/quotas
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "maxKnowledgeBases": 25,
  "maxAgents": 10
}
```

### Delete Tenant

```bash
DELETE /api/v1/tenants/{tenantId}
Authorization: Bearer <admin-token>
```

### List Members

```bash
GET /api/v1/tenants/{tenantId}/members
Authorization: Bearer <admin-token>
```

### Add Member

```bash
POST /api/v1/tenants/{tenantId}/members
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "email": "member@example.com",
  "role": "member"
}
```

---

Next: [AI Model Configuration](./model-configuration.md)
