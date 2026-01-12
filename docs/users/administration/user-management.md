# User Management

This guide covers managing users as a system administrator.

## User Overview

### User Types

Grounded has two levels of user access:

| Type | Description |
|------|-------------|
| **Regular User** | Can belong to tenants with assigned roles |
| **System Admin** | Platform-wide access, can manage all resources |

### User Properties

| Property | Description |
|----------|-------------|
| Email | Unique identifier and login |
| Created At | Account creation date |
| Is System Admin | Has platform-wide access |
| Is Disabled | Account is deactivated |
| Identities | Linked authentication providers |
| Tenant Memberships | Tenants the user belongs to |

## Viewing Users

**Navigate to:** Administration > Users

The user list shows:
- Email address
- Admin status (badge)
- Disabled status
- Creation date
- Actions menu

### Filtering and Search

- **Search**: Filter by email
- **Show Admins Only**: Toggle to see only system admins
- **Show Disabled**: Toggle to include disabled accounts

## Creating Users

### Method 1: User Self-Registration

If local registration is enabled (Settings > Authentication):

1. User visits the login page
2. Clicks "Register"
3. Enters email and password
4. Account is created automatically

### Method 2: Admin Creation

1. Go to **Users** > **Create User**
2. Enter the user's email
3. System generates a temporary password
4. Click **Create**
5. Share the temporary password with the user
6. User must change password on first login

### Method 3: OIDC Provisioning

If OIDC is configured:

1. User clicks "Sign in with SSO"
2. Authenticates with identity provider
3. Account is created automatically
4. User inherits claims from identity provider

## Managing User Access

### Granting System Admin

To make a user a system administrator:

1. Find the user in the list
2. Click the **Actions** menu (⋮)
3. Select **Grant Admin**
4. Confirm the action

System admins can:
- Access all tenants
- Configure system settings
- Manage AI models
- View all analytics
- Create/delete tenants

### Revoking System Admin

1. Find the admin user
2. Click **Actions** > **Revoke Admin**
3. Confirm the action

**Note:** You cannot revoke your own admin access.

### Disabling Accounts

To temporarily disable a user:

1. Find the user
2. Click **Actions** > **Disable Account**
3. Confirm

Disabled users:
- Cannot log in
- Retain their data
- Can be re-enabled later

### Re-enabling Accounts

1. Enable "Show Disabled" filter
2. Find the disabled user
3. Click **Actions** > **Enable Account**

### Deleting Users

**Warning:** User deletion is permanent and removes all user data.

1. Find the user
2. Click **Actions** > **Delete User**
3. Type the user's email to confirm
4. Click **Delete**

Deleting a user:
- Removes the user account
- Removes all tenant memberships
- **Does not** delete content they created

## User Details

Click on a user to view detailed information:

### Profile Tab

- Email address
- Account status
- Creation date
- Last login (if tracked)

### Identities Tab

Shows linked authentication methods:
- Local (email/password)
- OIDC providers (if configured)

### Memberships Tab

Lists all tenant memberships:
- Tenant name
- Role (owner, admin, member, viewer)
- Joined date

### Actions

From the user detail view:
- Change password (local accounts)
- Force password reset
- Manage admin status
- Disable/enable account

## Bulk Operations

### Export User List

1. Go to **Users**
2. Apply any filters
3. Click **Export**
4. Download CSV with user data

### Bulk Disable

Currently, users must be disabled individually. For bulk operations, use the API:

```bash
# Disable multiple users via API
curl -X PUT https://grounded.yourdomain.com/api/v1/admin/users/{userId} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isDisabled": true}'
```

## Password Management

### Password Requirements

Default password policy:
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number

### Resetting Passwords

**For Local Accounts:**

1. Find the user
2. Click **Actions** > **Reset Password**
3. New temporary password is generated
4. Share with user securely

**For OIDC Accounts:**

Password reset must be done through the identity provider.

### Users Changing Their Own Password

Users can change their password:

1. Click profile menu (top right)
2. Select **Change Password**
3. Enter current and new password
4. Click **Save**

## Authentication Troubleshooting

### "Invalid credentials" Error

- Verify email is correct
- Check if account is disabled
- Reset password if needed

### "Account not found" Error

- User hasn't registered
- Check for typos in email

### OIDC Login Fails

- Verify OIDC configuration
- Check identity provider logs
- Ensure redirect URI is correct

### User Locked Out

If a user can't access their account:

1. Verify account isn't disabled
2. Reset their password
3. Check for OIDC issues

## Security Best Practices

### For Administrators

1. **Limit system admins** - Only grant to those who need it
2. **Regular audits** - Review user list periodically
3. **Disable inactive accounts** - Deactivate unused accounts
4. **Use OIDC** - Centralize authentication where possible
5. **Monitor login activity** - Watch for suspicious patterns

### For Users

1. **Strong passwords** - Use unique, complex passwords
2. **Don't share credentials** - Each user needs their own account
3. **Report issues** - Notify admins of suspicious activity

## API Reference

### List Users

```bash
GET /api/v1/admin/users
Authorization: Bearer <admin-token>
```

### Get User

```bash
GET /api/v1/admin/users/{userId}
Authorization: Bearer <admin-token>
```

### Create User

```bash
POST /api/v1/admin/users
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "email": "user@example.com"
}
```

### Update User

```bash
PUT /api/v1/admin/users/{userId}
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "isSystemAdmin": true,
  "isDisabled": false
}
```

### Delete User

```bash
DELETE /api/v1/admin/users/{userId}
Authorization: Bearer <admin-token>
```

---

Next: [Tenant Management](./tenant-management.md)
