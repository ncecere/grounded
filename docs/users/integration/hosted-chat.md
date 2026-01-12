# Hosted Chat Pages

Grounded provides standalone hosted chat pages that don't require any integration - just share a URL.

## Overview

Hosted chat pages are:
- **Standalone**: Full chat interface at a URL
- **Zero integration**: No code required
- **Branded**: Shows your agent name and logo
- **Full-featured**: All chat capabilities included

## Creating a Hosted Chat Page

### Generate the URL

1. Go to **Agents** > Select your agent
2. Click **Tokens** tab
3. Click **Create Endpoint**
4. Select **Hosted** as the type
5. Optionally set an expiration date
6. Click **Create**
7. Copy the generated URL

### URL Format

```
https://your-grounded-instance.com/api/v1/c/{token}
```

The token is a unique identifier for this hosted page.

## Sharing the URL

### Direct Link

Share the URL directly:
- In emails
- Support tickets
- Documentation
- Chat applications

### QR Code

Generate a QR code for the URL:
- Physical locations
- Print materials
- Mobile access

### Embed in iframe

```html
<iframe
  src="https://your-grounded-instance.com/api/v1/c/your-token"
  width="100%"
  height="600"
  frameborder="0"
></iframe>
```

## Page Features

### Header

The page header shows:
- Agent logo (if configured)
- Agent name
- "Knowledge Assistant" subtitle

### Welcome State

Before the first message:
- Welcome icon
- Welcome message (from agent config)
- Prompt to start chatting

### Chat Interface

Full chat capabilities:
- Message input
- Send button
- Streaming responses
- Markdown rendering
- Code syntax highlighting

### Citations

After assistant responses:
- Inline citation markers [1], [2]
- Expandable sources section
- Clickable source links

### Footer

"Powered by Grounded" branding with link.

## Customization

### Agent-Level Settings

Customize through agent configuration:

| Setting | Effect |
|---------|--------|
| **Name** | Header title |
| **Logo URL** | Header logo |
| **Welcome Message** | Initial greeting |
| **System Prompt** | Response behavior |

### Branding

The hosted page shows:
- Your agent's name and logo
- "Powered by Grounded" footer

For white-label options, contact support.

## Use Cases

### Customer Support

Create a support chat page:
1. Configure agent with support KB
2. Generate hosted URL
3. Share in support emails:

```
Need help? Chat with our AI assistant:
https://support.yourcompany.com/chat/abc123
```

### Documentation Help

Add to documentation:

```markdown
## Need Help?

Have questions about this documentation?
[Chat with our AI assistant](https://docs.yourcompany.com/chat/xyz789)
```

### Internal Tools

For employee access:
1. Create internal-focused agent
2. Generate hosted URL
3. Add to intranet

### Demos and Trials

For showcasing capabilities:
1. Configure demo agent
2. Generate hosted URL
3. Share with prospects

## Multiple Hosted Pages

### Per-Audience Pages

Create different pages for different audiences:

| Audience | Agent | URL |
|----------|-------|-----|
| Customers | Customer Support | /chat/customer |
| Partners | Partner Support | /chat/partner |
| Internal | Employee FAQ | /chat/internal |

### A/B Testing

Test different configurations:
1. Create two agents with different settings
2. Generate URLs for each
3. Compare analytics

## Managing Tokens

### Viewing Active Tokens

1. Go to **Agents** > Select agent
2. Click **Tokens** tab
3. See all hosted endpoints

Each token shows:
- Creation date
- Expiration (if set)
- Status

### Revoking Access

To disable a hosted page:

1. Find the token
2. Click **Revoke**
3. Confirm

The URL will immediately stop working.

### Rotating Tokens

For security, periodically rotate:

1. Create new token
2. Update shared links
3. Revoke old token

## Security Considerations

### Token Security

- Tokens grant public access
- Anyone with the URL can chat
- Don't share sensitive tokens publicly

### Access Control

If you need restricted access:
1. Use the widget with domain restrictions
2. Or use the authenticated API
3. Or implement your own gateway

### Rate Limiting

Hosted pages are rate-limited:
- 60 requests per minute per token
- Prevents abuse
- Configurable by admin

### Expiration

Set expiration for temporary access:
- Demo tokens
- Time-limited trials
- Promotional campaigns

## Analytics

Track hosted page usage:

1. Go to **Analytics**
2. Filter by channel: `chat_endpoint`
3. See:
   - Query volume
   - Response times
   - Error rates

## Mobile Experience

Hosted pages are mobile-responsive:
- Full-width on small screens
- Touch-optimized input
- Appropriate keyboard handling

Test on mobile devices before sharing widely.

## Embedding Options

### Full Page iframe

```html
<iframe
  src="https://grounded.example.com/api/v1/c/token"
  style="width: 100%; height: 100vh; border: none;"
></iframe>
```

### Popup Window

```javascript
function openChat() {
  window.open(
    'https://grounded.example.com/api/v1/c/token',
    'chat',
    'width=400,height=600'
  );
}
```

### Modal Dialog

```html
<div id="chat-modal" class="modal">
  <div class="modal-content">
    <button onclick="closeModal()">Close</button>
    <iframe src="https://grounded.example.com/api/v1/c/token"></iframe>
  </div>
</div>
```

## Troubleshooting

### "Chat Not Found" Error

- Token may be revoked
- Token may be expired
- Check token status in admin

### "Agent Not Found" Error

- Agent may be deleted
- Agent may be disabled
- Check agent status

### Page Not Loading

- Check network connectivity
- Verify URL is correct
- Check browser console for errors

### Slow Responses

- Check knowledge base status
- Verify agent is properly configured
- Check system health

## Comparison: Widget vs Hosted

| Feature | Widget | Hosted |
|---------|--------|--------|
| Integration | JavaScript snippet | None (just URL) |
| Customization | Full CSS control | Limited |
| Domain control | Yes | No |
| Branding | Your site's look | Grounded branding |
| Best for | Integrated experience | Quick sharing |

## API Reference

### Get Page Configuration

```bash
GET /api/v1/c/{token}/config
```

**Response:**
```json
{
  "agentName": "Support Bot",
  "description": "Customer support assistant",
  "welcomeMessage": "How can I help you today?",
  "logoUrl": "https://example.com/logo.png",
  "endpointType": "hosted"
}
```

### Page Endpoint

```bash
GET /api/v1/c/{token}
```

Returns the full HTML page for the hosted chat.

---

Need more integration options? See:
- [Widget Integration](./widget.md) - Embedded chat
- [API Integration](./api.md) - Programmatic access
