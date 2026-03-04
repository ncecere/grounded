# Widget & Embedding

The Grounded chat widget lets you add an AI chat assistant to any website. It appears as a floating button that opens a chat panel when clicked.

## Configuring the Widget

1. Go to **Agents** → click **Configure** on an agent → **Widget** tab

![Widget Configuration](./screenshots/agent-config-widget.png)

### Button Appearance

| Setting | Options | Description |
|---------|---------|-------------|
| **Button Style** | Circle, Pill, Square | Shape of the floating button |
| **Button Size** | Small, Medium, Large | Size of the button |
| **Button Position** | Bottom-right, Bottom-left | Where the button appears on the page |
| **Button Icon** | Chat, Help, Question, Message | Built-in icon options |
| **Custom Icon URL** | Any image URL | Use your own icon instead of built-in ones |
| **Button Color** | Preset colors or hex code | Color of the button |

### Color Presets
Choose from quick color presets: Blue, Indigo, Purple, Pink, Red, Orange, Green, Teal, Slate, Black. Or enter a custom hex color code.

### Generating a Widget Token

1. In the Widget tab, click **Generate New Token**
2. The token is displayed and can be copied
3. You can have multiple tokens per agent (useful for different websites)
4. Tokens can be revoked if compromised

### Testing the Widget

Click **Test Widget in New Tab** to preview how the widget will look and behave on a webpage.

## Embedding on Your Website

Add the following code to your website's HTML, just before the closing `</body>` tag:

```html
<script src="https://your-grounded-instance.com/widget.js"></script>
<script>
  Grounded.init({
    token: "your-widget-token-here",
    apiBase: "https://your-grounded-instance.com"
  });
</script>
```

### Configuration Options

```javascript
Grounded.init({
  // Required
  token: "your-widget-token",
  apiBase: "https://your-grounded-instance.com",
  
  // Optional
  position: "bottom-right",    // or "bottom-left"
  colorScheme: "auto",         // "light", "dark", or "auto" (matches system)
  showReasoning: false          // Show AI reasoning steps (Advanced RAG only)
});
```

## Domain Restrictions

For security, you can restrict which websites can use your widget token:

1. In the Widget tab, find **Allowed Domains**
2. Add the domains where the widget should work (e.g., `example.com`, `docs.example.com`)
3. Leave empty to allow all domains

## Hosted Chat Pages

If you don't want to embed a widget, you can create a hosted chat page:

1. Go to agent **Configure** → **Chat & API** tab
2. Click **Create Hosted Chat Page**
3. A URL is generated (e.g., `https://your-instance.com/chat/abc123`)
4. Share this URL with users — they'll get a full-page chat experience

Hosted chat pages:
- Work on any device (desktop, mobile)
- Include the agent's name and welcome message
- Support light/dark themes
- Don't require any code changes to your website

## Chat Endpoint Tokens (API Access)

For programmatic access without a widget:

1. Go to agent **Configure** → **Chat & API** tab
2. Click **Create API Endpoint** or **Create Hosted Chat Page**
3. Each token has a type:
   - **API** — For programmatic `POST` requests (returns SSE stream)
   - **Hosted** — Renders a full-page chat UI at a shareable URL

### API Usage Example

```bash
curl -N -X POST https://your-instance.com/api/v1/c/YOUR_TOKEN/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How do I reset my password?"}'
```

The response streams back as Server-Sent Events:
```
data: {"type":"status","status":"generating","message":"Found 3 sources..."}
data: {"type":"text","content":"To reset your "}
data: {"type":"text","content":"password, go to..."}
data: {"type":"sources","sources":[{"title":"Password FAQ","snippet":"..."}]}
data: {"type":"done","conversationId":"abc-123"}
```

Include `conversationId` in follow-up requests for multi-turn conversations:
```bash
curl -N -X POST https://your-instance.com/api/v1/c/YOUR_TOKEN/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What if I forgot my email too?", "conversationId": "abc-123"}'
```

## Rate Limiting

Public chat endpoints have three layers of rate limiting:

| Layer | Default | Purpose |
|-------|---------|---------|
| **Per tenant** | 60/min | Protects overall tenant resources |
| **Per token** | 30/min | Prevents one endpoint from consuming all capacity |
| **Per IP** | 60/min | Prevents abuse from a single client |

Rate limits are configurable per tenant in **Settings** → **Quotas**.

## Widget Features

- **Responsive** — Works on desktop and mobile devices
- **Shadow DOM** — Widget styles don't interfere with your website's CSS
- **Dark mode** — Automatically matches user's system preference (or force light/dark)
- **Citations** — Sources are displayed with links in the chat
- **Reasoning panel** — For Advanced RAG agents, optionally shows the AI's thinking process
- **Conversation persistence** — Chat history maintained during the browser session

## Security Best Practices

| Practice | Why |
|----------|-----|
| Set **Allowed Domains** | Prevents your widget from being embedded on unauthorized sites |
| Use separate tokens per site | Revoke one without affecting others |
| Monitor usage in **Analytics** | Spot unusual traffic patterns |
| Rotate tokens periodically | Reduce exposure window for leaked tokens |
| Enable OIDC for sensitive content | Require authentication before chatting |

## Tips

- **Match your brand** — Use your brand color and custom icon
- **Test on your site** — Always test the widget on your actual website before going live
- **Multiple agents** — You can have different agents (with different widget tokens) on different pages
- **Revoke if needed** — If a token is compromised, revoke it immediately and generate a new one
- **Use hosted pages for quick sharing** — No code changes needed, just share a URL
