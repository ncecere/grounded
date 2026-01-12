# Agents

Agents are AI-powered chat assistants that answer questions using your knowledge bases.

## Overview

An agent combines:
- **Knowledge Bases**: Content the agent can reference
- **System Prompt**: Instructions for how to respond
- **LLM Model**: The AI that generates responses
- **Retrieval Settings**: How content is searched

## Creating an Agent

### Basic Setup

1. Navigate to **Agents**
2. Click **Create Agent**
3. Fill in basic details:
   - **Name**: Agent identifier (e.g., "Support Bot")
   - **Description**: What this agent does
   - **Welcome Message**: First message shown to users

4. Select **Knowledge Bases**:
   - Choose one or more KBs
   - Agent can reference all attached KBs

5. Click **Create**

### Initial Configuration

After creation, configure additional settings:

| Setting | Purpose |
|---------|---------|
| System Prompt | Define agent personality and rules |
| LLM Model | Choose which AI model to use |
| Retrieval Config | Tune search parameters |
| Widget Settings | Customize embedded widget |

## System Prompt

The system prompt instructs the AI how to behave.

### Default Prompt

Grounded provides a sensible default:

```
You are a helpful assistant that answers questions based on the provided context.
Always cite your sources using [1], [2], etc. format.
If you don't find relevant information in the context, say so honestly.
Never make up information that isn't in the provided context.
```

### Customizing the Prompt

Go to **Agent** > **Settings** > **System Prompt**

**Example: Support Bot**
```
You are a friendly customer support agent for [Company Name].
Your role is to help customers with questions about our products and services.

Guidelines:
- Be helpful, professional, and concise
- Always cite specific documentation when possible
- If you don't know something, direct users to contact support
- Never discuss competitor products
- Keep responses under 200 words unless the user asks for more detail

Tone: Friendly but professional
```

**Example: Technical Documentation**
```
You are a technical documentation assistant.
Help developers understand our API and implementation details.

Guidelines:
- Provide code examples when relevant
- Be precise and technical
- Reference specific documentation sections
- If the question is outside the documentation scope, say so
- Use markdown formatting for code snippets
```

### Prompt Best Practices

| Do | Don't |
|----|----|
| Be specific about the role | Use vague instructions |
| Define response format | Leave format undefined |
| Set boundaries clearly | Allow unlimited scope |
| Include example behaviors | Assume AI understands context |

## LLM Model Selection

### Choosing a Model

Go to **Agent** > **Settings** > **Model**

Available models depend on your admin's configuration. Common options:

| Model | Best For |
|-------|----------|
| GPT-4o | General use, high quality |
| GPT-4o-mini | Fast responses, lower cost |
| Claude Sonnet | Nuanced responses |
| Claude Haiku | Speed-critical applications |

### Model Considerations

**Quality vs Cost**
- Larger models give better answers
- Smaller models are faster and cheaper
- Test both for your use case

**Context Window**
- Larger windows handle more context
- Important for complex questions
- Most models have sufficient windows for RAG

## Retrieval Configuration

Control how the agent searches knowledge bases.

### Settings

Go to **Agent** > **Retrieval Config**

| Setting | Default | Description |
|---------|---------|-------------|
| **Top K** | 8 | Number of chunks sent to LLM |
| **Candidate K** | 40 | Initial search pool size |
| **Max Citations** | 3 | Citations shown to users |
| **Reranker** | Enabled | Improve result ordering |

### Tuning Guide

**Top K (Sources to LLM)**
- Higher = more context, better coverage
- Lower = faster, more focused
- Recommendation: 5-10 for most cases

**Candidate K (Search Pool)**
- Higher = more potential matches
- Lower = faster search
- Keep at 4-5x Top K

**Max Citations**
- Higher = more source visibility
- Lower = cleaner responses
- Match to response complexity

**Reranker**
- Enabled: Better relevance ordering
- Disabled: Faster responses
- Recommendation: Keep enabled

### Testing Changes

1. Adjust settings
2. Use **Test Chat** to evaluate
3. Compare response quality
4. Iterate until satisfied

## Testing Your Agent

### Test Chat

Access via **Agent** > **Test Chat**

Test features:
- Send messages as users would
- See full responses with citations
- View retrieval metadata
- Debug issues

### What to Test

**Coverage**
- Questions about different topics
- Edge cases in your content
- Topics not in knowledge base

**Quality**
- Response accuracy
- Citation relevance
- Appropriate length
- Correct tone

**Edge Cases**
- Ambiguous questions
- Out-of-scope queries
- Multi-part questions

### Test Checklist

- [ ] Basic questions answered correctly
- [ ] Citations point to relevant sources
- [ ] Out-of-scope handled gracefully
- [ ] Response tone matches expectations
- [ ] No hallucinated information

## Deployment Options

### Widget (Embedded Chat)

Embed the agent as a chat widget on your website.

1. Go to **Agent** > **Widget**
2. Customize appearance
3. Generate a token
4. Copy the embed code
5. Add to your website

See [Widget Integration](../integration/widget.md) for details.

### API (Programmatic)

Integrate the agent via REST API.

1. Go to **Agent** > **Tokens**
2. Create an API token
3. Use the endpoint in your application

See [API Integration](../integration/api.md) for details.

### Hosted Page

Share a direct link to a hosted chat page.

1. Go to **Agent** > **Tokens**
2. Create a "Hosted" endpoint
3. Share the generated URL

See [Hosted Chat](../integration/hosted-chat.md) for details.

## Managing Multiple Agents

### Use Cases for Multiple Agents

- **Different audiences**: Customer vs. internal
- **Different topics**: Sales vs. Support
- **Different channels**: Website vs. app
- **A/B testing**: Compare configurations

### Organizing Agents

**Naming Convention**
```
[Audience] - [Purpose]
Customer - General Support
Internal - Product FAQ
Partner - Technical Docs
```

### Sharing Knowledge Bases

Agents can share the same KB:
- Central content management
- Consistent information
- Different presentations

## Analytics

View agent performance in **Analytics**.

### Metrics

| Metric | Description |
|--------|-------------|
| Total Queries | Questions asked |
| Avg Response Time | Latency |
| Error Rate | Failed responses |
| Token Usage | LLM consumption |

### Monitoring

Track over time:
- Daily query volume
- Response quality trends
- Error patterns

## Advanced Configuration

### Citations

**Enable/Disable**
- Some use cases don't need visible citations
- Toggle in agent settings

**Citation Format**
- Default: `[1]`, `[2]` inline
- Expandable sources section

### Agent Enable/Disable

Temporarily disable an agent:
1. Go to **Agent** > **Settings**
2. Toggle **Enabled**
3. Disabled agents return errors

Use for:
- Maintenance periods
- Testing before release
- Deprecating old agents

## Troubleshooting

### Poor Response Quality

**Check**:
1. Knowledge base has relevant content
2. Content is fully indexed
3. System prompt is appropriate
4. Top K is sufficient

**Try**:
1. Increase Top K
2. Improve system prompt
3. Add more relevant content

### Slow Responses

**Check**:
1. Model selection
2. Top K setting
3. Knowledge base size

**Try**:
1. Use faster model (mini/haiku)
2. Reduce Top K
3. Optimize content

### Hallucinations

**Check**:
1. System prompt includes anti-hallucination instructions
2. Content covers the topic
3. Citations are enabled

**Try**:
1. Strengthen system prompt
2. Add more specific content
3. Lower temperature setting

### Missing Citations

**Check**:
1. Citations enabled in settings
2. Content indexed successfully
3. Query matches content

**Try**:
1. Verify retrieval settings
2. Test with explicit questions
3. Check chunk quality

## API Reference

### List Agents

```bash
GET /api/v1/agents
X-Tenant-ID: <tenant-id>
Authorization: Bearer <token>
```

### Create Agent

```bash
POST /api/v1/agents
X-Tenant-ID: <tenant-id>
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Support Bot",
  "description": "Customer support assistant",
  "welcomeMessage": "How can I help you today?",
  "systemPrompt": "You are a helpful support assistant...",
  "kbIds": ["kb-uuid-1", "kb-uuid-2"]
}
```

### Update Agent

```bash
PUT /api/v1/agents/{agentId}
X-Tenant-ID: <tenant-id>
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Name",
  "systemPrompt": "Updated prompt..."
}
```

### Chat with Agent

```bash
POST /api/v1/chat/{agentId}
X-Tenant-ID: <tenant-id>
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "How do I reset my password?",
  "conversationId": "optional-conversation-id"
}
```

---

Next: [Team Management](./team-management.md)
