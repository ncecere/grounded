# Chat Widget Integration

The Grounded widget allows you to embed AI chat on any website with a simple JavaScript snippet.

## Overview

The widget provides:
- Floating chat button
- Full chat interface
- Markdown rendering
- Citation display
- Conversation history
- Customizable appearance

## Quick Start

### 1. Get Widget Token

1. Go to **Agents** > Select your agent
2. Click **Widget** tab
3. Click **Create Token**
4. Copy the generated token

### 2. Add to Website

Add this code before the closing `</body>` tag:

```html
<script>
  window.grounded = window.grounded || function() {
    (window.grounded.q = window.grounded.q || []).push(arguments);
  };
</script>
<script src="https://your-grounded-instance.com/widget.js" async></script>
<script>
  grounded('init', {
    token: 'your-widget-token-here'
  });
</script>
```

Replace:
- `https://your-grounded-instance.com` with your Grounded URL
- `your-widget-token-here` with your token

### 3. Done!

The chat button will appear on your site.

## Configuration Options

### Basic Options

```javascript
grounded('init', {
  token: 'your-token',
  position: 'bottom-right',  // or 'bottom-left'
  initiallyOpen: false,      // Start with chat open
  hideButton: false          // Hide the launcher button
});
```

### Appearance Customization

Widget appearance is configured in the Grounded admin panel:

1. Go to **Agent** > **Widget** tab
2. Customize:

| Option | Description |
|--------|-------------|
| **Primary Color** | Main accent color |
| **Background** | Chat window background |
| **Text Color** | Message text color |
| **Border Radius** | Corner roundness |

### Button Customization

| Option | Values |
|--------|--------|
| **Position** | bottom-right, bottom-left |
| **Style** | circle, pill, square |
| **Size** | 48-72 pixels |
| **Icon** | chat, message, help |

## JavaScript API

### Initialize

```javascript
grounded('init', { token: 'your-token' });
```

### Open Chat

```javascript
grounded('open');
```

### Close Chat

```javascript
grounded('close');
```

### Toggle Chat

```javascript
grounded('toggle');
```

### Set User Context

Pass user information for personalization:

```javascript
grounded('setUser', {
  id: 'user-123',
  name: 'John Doe',
  email: 'john@example.com'
});
```

### Send Message Programmatically

```javascript
grounded('sendMessage', 'Hello, I need help with...');
```

### Listen to Events

```javascript
grounded('on', 'open', function() {
  console.log('Chat opened');
});

grounded('on', 'close', function() {
  console.log('Chat closed');
});

grounded('on', 'message', function(message) {
  console.log('New message:', message);
});
```

## Advanced Integration

### Single Page Applications (SPA)

For React, Vue, Angular, etc.:

```javascript
// Initialize once when app loads
useEffect(() => {
  window.grounded('init', { token: 'your-token' });
}, []);

// Open programmatically
function openSupport() {
  window.grounded('open');
}
```

### React Component

```jsx
import { useEffect } from 'react';

export function ChatWidget({ token }) {
  useEffect(() => {
    // Load widget script
    const script = document.createElement('script');
    script.src = 'https://your-grounded-instance.com/widget.js';
    script.async = true;
    document.body.appendChild(script);

    script.onload = () => {
      window.grounded('init', { token });
    };

    return () => {
      document.body.removeChild(script);
    };
  }, [token]);

  return null;
}
```

### Vue Component

```vue
<script setup>
import { onMounted, onUnmounted } from 'vue';

const props = defineProps(['token']);

onMounted(() => {
  const script = document.createElement('script');
  script.src = 'https://your-grounded-instance.com/widget.js';
  script.async = true;
  document.body.appendChild(script);

  script.onload = () => {
    window.grounded('init', { token: props.token });
  };
});

onUnmounted(() => {
  // Cleanup if needed
});
</script>
```

### Conditional Loading

Load widget only on certain pages:

```javascript
// Only on /help pages
if (window.location.pathname.startsWith('/help')) {
  grounded('init', { token: 'your-token' });
}
```

### Custom Trigger Button

Hide the default button and use your own:

```html
<button onclick="grounded('open')">
  Need Help?
</button>

<script>
  grounded('init', {
    token: 'your-token',
    hideButton: true
  });
</script>
```

## Domain Restrictions

### Allowing Specific Domains

Configure in the admin panel:

1. Go to **Agent** > **Widget** > **Access Control**
2. Set **Public Access** to restricted
3. Add allowed domains:
   ```
   example.com
   app.example.com
   *.example.com
   ```

### Testing Locally

For local development, add:
```
localhost
127.0.0.1
```

## Authentication

### Public Access

Default mode - anyone can chat:

```javascript
grounded('init', { token: 'public-token' });
```

### Authenticated Access

Require users to be logged in:

1. Enable **Require Authentication** in widget settings
2. Pass user identity:

```javascript
grounded('init', {
  token: 'your-token',
  userToken: 'jwt-from-your-auth-system'
});
```

## Conversation Persistence

### How It Works

Conversations are stored locally:
- Browser localStorage
- Persists across page refreshes
- Cleared when browser data is cleared

### Custom Storage Key

```javascript
grounded('init', {
  token: 'your-token',
  storageKey: 'my-custom-key'
});
```

### Clearing Conversations

```javascript
grounded('clearHistory');
```

## Styling

### CSS Variables

Override widget styles with CSS variables:

```css
:root {
  --grounded-primary: #2563eb;
  --grounded-bg: #ffffff;
  --grounded-text: #1f2937;
  --grounded-border-radius: 16px;
}
```

### Shadow DOM

The widget uses Shadow DOM for isolation. To override internal styles:

```javascript
grounded('init', {
  token: 'your-token',
  styles: `
    .grounded-message { font-size: 15px; }
    .grounded-header { background: #1a1a1a; }
  `
});
```

## Performance

### Lazy Loading

Load widget only when needed:

```javascript
function loadChatWidget() {
  const script = document.createElement('script');
  script.src = 'https://your-grounded-instance.com/widget.js';
  script.onload = () => grounded('init', { token: 'your-token' });
  document.body.appendChild(script);
}

// Load on user action
document.getElementById('help-btn').onclick = loadChatWidget;
```

### Bundle Size

- Widget: ~30KB gzipped
- No external dependencies
- Loads asynchronously

## Testing

### Test Page

Use the built-in test page:

```
https://your-grounded-instance.com/test-widget.html?token=your-token
```

### Debug Mode

Enable console logging:

```javascript
grounded('init', {
  token: 'your-token',
  debug: true
});
```

## Troubleshooting

### Widget Not Appearing

**Check:**
1. Script is loading (Network tab)
2. Token is valid
3. No JavaScript errors
4. Domain is allowed

**Try:**
1. Check browser console
2. Verify token in admin panel
3. Test on allowed domain

### Chat Not Responding

**Check:**
1. Agent is enabled
2. Knowledge bases have content
3. API connectivity

**Try:**
1. Test agent in admin panel
2. Check network requests
3. Verify CORS settings

### Styling Issues

**Check:**
1. CSS conflicts
2. Z-index issues
3. Container overflow

**Try:**
1. Increase z-index
2. Check parent element styles
3. Use isolation CSS

### Mobile Issues

**Check:**
1. Viewport meta tag
2. Touch event handling
3. Keyboard behavior

**Try:**
1. Test on actual device
2. Check responsive styles
3. Verify input handling

## Security

### Content Security Policy

If using CSP, add:

```
script-src 'self' https://your-grounded-instance.com;
connect-src 'self' https://your-grounded-instance.com;
style-src 'self' 'unsafe-inline';
```

### CORS

Widget requests are handled by the Grounded API with proper CORS headers.

### Data Privacy

- Conversations stored in user's browser
- Only sent to your Grounded instance
- No third-party tracking

## Next Steps

- [API Integration](./api.md) - Direct API access
- [Hosted Chat](./hosted-chat.md) - Standalone chat pages

---

Need help? Check the [Troubleshooting](#troubleshooting) section or contact support.
