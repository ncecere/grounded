# REST API Integration

Integrate Grounded chat capabilities directly into your applications using the REST API.

## Overview

The Grounded API provides:
- Chat completion with RAG
- Streaming responses
- Conversation management
- Full citation support

## Creating an API Endpoint

To use the REST API, create a Chat Endpoint for your agent:

1. Go to **Agents** > Select your agent
2. Click the **Chat** button (or Deploy icon)
3. Click **Create API Endpoint**
4. Copy the generated endpoint URL

The endpoint URL will look like:
```
https://your-domain.com/api/v1/c/{token}/chat
```

The token is embedded in the URL - no Authorization header is needed for public chat endpoints.

## Endpoints

### Chat Endpoints (Public)

These endpoints use the token in the URL path - no Authorization header needed.

#### Non-Streaming Chat

```
POST /api/v1/c/{token}/chat
```

**Request:**
```json
{
  "message": "How do I reset my password?",
  "conversationId": "optional-conversation-id"
}
```

**Response:**
```json
{
  "answer": "To reset your password, follow these steps:\n\n1. Go to the login page\n2. Click 'Forgot Password'...",
  "citations": [
    {
      "index": 1,
      "title": "Password Reset Guide",
      "url": "https://docs.example.com/password-reset",
      "snippet": "If you've forgotten your password..."
    }
  ],
  "conversationId": "conv_abc123"
}
```

#### Streaming Chat

```
POST /api/v1/c/{token}/chat/stream
```

**Request:** Same as non-streaming

**Response:** Server-Sent Events (SSE)

```
data: {"type":"status","status":"searching","message":"Searching knowledge base..."}

data: {"type":"status","status":"generating","message":"Found 5 relevant sources. Generating response..."}

data: {"type":"text","content":"To reset"}

data: {"type":"text","content":" your password"}

data: {"type":"text","content":", follow these steps..."}

data: {"type":"done","conversationId":"conv_abc123","citations":[...]}
```

### Authenticated Endpoints

These require user authentication and tenant context.

#### Chat (Authenticated)

```
POST /api/v1/chat/{agentId}
X-Tenant-ID: <tenant-id>
Authorization: Bearer <user-jwt>
```

**Request:**
```json
{
  "message": "What are our refund policies?",
  "conversationId": "optional-id"
}
```

#### Chat Streaming (Authenticated)

```
GET /api/v1/chat/{agentId}?message=query&conversationId=optional
X-Tenant-ID: <tenant-id>
Authorization: Bearer <user-jwt>
```

Returns SSE stream.

## Code Examples

### cURL

```bash
# Non-streaming
curl -X POST "https://grounded.example.com/api/v1/c/your-token/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "How do I get started?"}'

# Streaming
curl -X POST "https://grounded.example.com/api/v1/c/your-token/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"message": "How do I get started?"}'
```

### JavaScript/Node.js

```javascript
// Non-streaming
async function chat(message, conversationId = null) {
  const response = await fetch('https://grounded.example.com/api/v1/c/your-token/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      conversationId,
    }),
  });

  return response.json();
}

// Usage
const result = await chat('How do I reset my password?');
console.log(result.answer);
console.log(result.citations);
```

### JavaScript Streaming

```javascript
async function chatStream(message, conversationId = null, onChunk) {
  const response = await fetch('https://grounded.example.com/api/v1/c/your-token/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      conversationId,
    }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let citations = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));

        if (data.type === 'text') {
          fullText += data.content;
          onChunk(data.content);
        } else if (data.type === 'done') {
          citations = data.citations;
          return { answer: fullText, citations, conversationId: data.conversationId };
        }
      }
    }
  }
}

// Usage
chatStream('How do I get started?', null, (chunk) => {
  process.stdout.write(chunk);  // Print as received
}).then(result => {
  console.log('\n\nCitations:', result.citations);
});
```

### Python

```python
import requests

def chat(message, conversation_id=None):
    response = requests.post(
        'https://grounded.example.com/api/v1/c/your-token/chat',
        json={
            'message': message,
            'conversationId': conversation_id
        }
    )
    return response.json()

# Usage
result = chat('How do I reset my password?')
print(result['answer'])
print(result['citations'])
```

### Python Streaming

```python
import requests
import json

def chat_stream(message, conversation_id=None):
    response = requests.post(
        'https://grounded.example.com/api/v1/c/your-token/chat/stream',
        json={
            'message': message,
            'conversationId': conversation_id
        },
        stream=True
    )

    full_text = ''
    citations = []
    final_conversation_id = None

    for line in response.iter_lines():
        if line:
            line = line.decode('utf-8')
            if line.startswith('data: '):
                data = json.loads(line[6:])

                if data['type'] == 'text':
                    full_text += data['content']
                    print(data['content'], end='', flush=True)
                elif data['type'] == 'done':
                    citations = data.get('citations', [])
                    final_conversation_id = data.get('conversationId')

    return {
        'answer': full_text,
        'citations': citations,
        'conversationId': final_conversation_id
    }

# Usage
result = chat_stream('How do I get started?')
print('\n\nCitations:', result['citations'])
```

### Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

type ChatRequest struct {
    Message        string `json:"message"`
    ConversationID string `json:"conversationId,omitempty"`
}

type ChatResponse struct {
    Answer         string     `json:"answer"`
    Citations      []Citation `json:"citations"`
    ConversationID string     `json:"conversationId"`
}

type Citation struct {
    Index   int    `json:"index"`
    Title   string `json:"title"`
    URL     string `json:"url"`
    Snippet string `json:"snippet"`
}

func chat(message string) (*ChatResponse, error) {
    reqBody, _ := json.Marshal(ChatRequest{Message: message})

    resp, err := http.Post(
        "https://grounded.example.com/api/v1/c/your-token/chat",
        "application/json",
        bytes.NewBuffer(reqBody),
    )
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var result ChatResponse
    json.NewDecoder(resp.Body).Decode(&result)
    return &result, nil
}

func main() {
    result, _ := chat("How do I get started?")
    fmt.Println(result.Answer)
}
```

## Conversation Management

### Maintaining Context

Pass `conversationId` to continue conversations:

```javascript
// First message
const first = await chat('What products do you offer?');

// Follow-up with context
const second = await chat('Tell me more about the first one', first.conversationId);
```

### Starting New Conversations

Omit `conversationId` to start fresh:

```javascript
const newChat = await chat('New question', null);
```

### Conversation Storage

Conversations are stored server-side with:
- 24-hour TTL by default
- Automatic cleanup
- Rate limiting per conversation

## Rate Limiting

API requests are rate-limited:

| Limit | Default |
|-------|---------|
| Requests per minute | 60 |
| Concurrent requests | 10 |

**Rate Limit Headers:**
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1699999999
```

**429 Response:**
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 60
}
```

## Error Handling

### Error Response Format

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### Common Errors

| Status | Code | Description |
|--------|------|-------------|
| 400 | INVALID_REQUEST | Malformed request |
| 401 | UNAUTHORIZED | Invalid or expired token |
| 404 | NOT_FOUND | Agent or endpoint not found |
| 429 | RATE_LIMITED | Too many requests |
| 500 | INTERNAL_ERROR | Server error |

### Handling Errors

```javascript
async function safeCchat(message) {
  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.json();

      if (response.status === 429) {
        // Rate limited - wait and retry
        await sleep(error.retryAfter * 1000);
        return safeChat(message);
      }

      throw new Error(error.error);
    }

    return response.json();
  } catch (err) {
    console.error('Chat error:', err);
    throw err;
  }
}
```

## Best Practices

### Retry Logic

```javascript
async function chatWithRetry(message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await chat(message);
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await sleep(1000 * Math.pow(2, i));  // Exponential backoff
    }
  }
}
```

### Timeout Handling

```javascript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);

try {
  const response = await fetch(url, {
    ...options,
    signal: controller.signal
  });
} finally {
  clearTimeout(timeout);
}
```

### Token Security

- Never expose tokens in client-side code
- Use environment variables
- Rotate tokens periodically
- Set appropriate expiration

## Testing

### Health Check

```bash
curl https://grounded.example.com/health
```

### Endpoint Configuration

```bash
curl https://grounded.example.com/api/v1/c/your-token/config
```

Returns:
```json
{
  "agentName": "Support Bot",
  "description": "...",
  "welcomeMessage": "How can I help?",
  "endpointType": "api"
}
```

---

Next: [Hosted Chat Pages](./hosted-chat.md)
