# Agents

Agents are AI assistants that answer questions using your knowledge bases. Each agent has its own personality (system prompt), retrieval settings, and can be published as a chat widget, API endpoint, or hosted chat page.

## Viewing Agents

Click **Agents** in the sidebar to see all agents in your tenant:

![Agents List](./screenshots/agents-list.png)

Each agent card shows:
- **Name** and description
- **Status** — Enabled (green) or disabled (gray)
- Quick action buttons: **Chat**, **Configure**, **Test Suites**, and **⋮** menu

---

## Creating an Agent

Click **Create Agent** to open the creation form with two tabs:

### Step 1: General Tab

![Create Agent General](./screenshots/create-agent-general.png)

| Field | Required | Description |
|-------|:--------:|-------------|
| **Name** | ✅ | The agent's display name (e.g., "Support Bot", "Product Expert") |
| **Description** | No | What this agent does — for your team's reference |
| **System Prompt** | ✅ | Instructions that define the agent's behavior, tone, and rules |
| **Welcome Message** | No | Greeting shown when a user starts a conversation (default: "How can I help?") |

### Step 2: Model & RAG Tab

![Create Agent Model & RAG](./screenshots/create-agent-model-rag-filled.png)

| Field | Description | Default |
|-------|-------------|---------|
| **RAG Type** | How the agent searches for answers (see [RAG Types](#rag-types) below) | Simple |
| **LLM Model** | Which AI model generates responses | System default |
| **Knowledge Bases** | Which KBs to search (check one or more) | None (must select) |
| **Top K** | How many source chunks to include in the AI's context | 8 |
| **Candidate K** | How many chunks to initially retrieve for ranking | 40 |
| **Max Citations** | How many source citations to show the user | 3 |
| **Similarity Threshold** | Minimum relevance score (0-1) for including a chunk | 0.5 |

Click **Create Agent** to finish.

---

## RAG Types

RAG (Retrieval-Augmented Generation) is how agents find and use knowledge to answer questions. Grounded supports two modes:

### Simple RAG (Default)

The agent performs a single search pass and generates a response:

1. User asks a question
2. System searches knowledge bases for relevant chunks
3. Top chunks are sent to the LLM with the question
4. LLM generates an answer with citations

**Best for:** Straightforward questions, fast responses, most use cases.

**Response time:** 1-3 seconds

### Advanced RAG

The agent uses a multi-step reasoning pipeline:

1. **Query Rewriting** — Reformulates the question using conversation history for clarity
2. **Sub-Query Planning** — Breaks complex questions into 1-5 focused sub-queries
3. **Parallel Search** — Searches knowledge bases for each sub-query simultaneously
4. **Result Merging** — Combines and deduplicates results from all searches
5. **Response Generation** — LLM generates a comprehensive answer

**Best for:** Complex or multi-part questions, research-style queries, when simple RAG misses relevant context.

**Response time:** 3-8 seconds

**Advanced RAG shows reasoning steps** in the chat interface, so users can see the agent's thinking process (this can be toggled off).

### When to Use Which

| Scenario | Recommended RAG | Why |
|----------|----------------|-----|
| "What is your return policy?" | Simple | Direct, single-topic question |
| "Compare product X and Y features" | Advanced | Needs to search for both products |
| Customer support widget | Simple | Speed matters for chat UX |
| Internal research tool | Advanced | Thoroughness matters more than speed |
| FAQ-style questions | Simple | Answers are usually in one chunk |
| "How does feature X relate to policy Y?" | Advanced | Cross-topic, needs multiple searches |

### Advanced RAG Settings

When using Advanced RAG, two additional settings appear:

| Setting | Description | Default | Range |
|---------|-------------|---------|-------|
| **History Turns** | Number of conversation turns used for query rewriting | 5 | 1-20 |
| **Max Sub-queries** | Maximum sub-queries generated per question | 3 | 1-5 |

---

## Configuring an Existing Agent

Click **Configure** on any agent card to open the configuration panel:

### General Tab

![Agent Config General](./screenshots/agent-config-general.png)

- **Enable/Disable toggle** — Disabled agents cannot be used for chat
- Edit name, description, system prompt, welcome message
- **Logo URL** — Custom branding image for the agent

### Model & RAG Tab

![Agent Config Model & RAG](./screenshots/agent-config-model-rag.png)

Same settings as during creation:
- Switch between Simple and Advanced RAG
- Change the LLM model
- Add or remove knowledge base attachments
- Tune retrieval parameters (Top K, Candidate K, etc.)

### Widget Tab

![Agent Config Widget](./screenshots/agent-config-widget.png)

Configure the embeddable chat widget that can be added to any website:

| Setting | Options | Description |
|---------|---------|-------------|
| **Button Style** | Circle, Pill, Square | Shape of the floating chat button |
| **Button Size** | Small, Medium, Large | Size of the button |
| **Button Position** | Bottom-right, Bottom-left | Where the button appears on the page |
| **Button Icon** | Chat, Help, Question, Message | Icon shown on the button |
| **Custom Icon URL** | Any image URL | Use your own brand icon |
| **Button Color** | Preset or hex code | Color of the chat button |

**Widget Tokens:** Generate tokens to embed the widget on websites. Each token is tied to this agent and can be restricted to specific domains.

**Test Widget:** Opens a preview page to see how the widget looks and functions.

See [Widget & Embedding](./06-widget-and-embedding.md) for full embed instructions.

### Chat & API Tab

![Agent Config Chat & API](./screenshots/agent-config-chat-api.png)

Three ways to access your agent programmatically:

| Action | What It Creates | Use Case |
|--------|----------------|----------|
| **Open Test Chat** | In-app chat window | Testing during development |
| **Create API Endpoint** | API token + endpoint URL | Backend integrations, custom apps |
| **Create Hosted Chat Page** | Shareable URL | Full-page chat experience, no coding needed |

**API Endpoint** generates a token and shows the API call format:
```bash
curl -X POST https://your-instance.com/api/v1/chat/endpoint \
  -H "Authorization: Bearer grounded_chat_xxxxx..." \
  -H "Content-Type: application/json" \
  -d '{"message": "What is your return policy?"}'
```

**Hosted Chat Page** creates a shareable link like:
```
https://your-instance.com/chat/hosted/abc123
```

---

## Writing Effective System Prompts

The system prompt is the most critical part of agent configuration. It tells the AI how to behave.

### Default System Prompt

New agents come with a sensible default:
```
You are a helpful assistant that answers questions based on the provided context.

IMPORTANT RULES:
1. Only answer questions based on the provided context
2. If the context does not contain enough information, say "I don't know based on the provided sources"
3. Always cite your sources with the document title and URL when available
4. Be concise and direct in your answers
5. Do not make up information that is not in the context
```

### Customizing the Prompt

Build on the default by adding:

**Identity and tone:**
```
You are a friendly customer support agent for Acme Corp.
Respond in a professional but conversational tone.
```

**Topic boundaries:**
```
Only answer questions about our products and services.
For billing questions, direct users to billing@acme.com.
For technical emergencies, tell them to call 1-800-SUPPORT.
```

**Response format:**
```
Keep responses under 3 paragraphs.
Use bullet points for lists.
Always end with "Is there anything else I can help with?"
```

**Handling unknowns:**
```
If you don't have enough information to answer fully, say what you DO know and suggest where the user might find more details.
```

### Prompt Tips

| Do | Don't |
|----|-------|
| Be specific about behavior | Leave the prompt empty |
| Define what topics to cover | Write overly long prompts (>500 words) |
| Set a clear tone | Give contradictory instructions |
| Include fallback behavior | Assume the AI knows your business context |
| Test after each change | Make many changes at once |

---

## Retrieval Tuning Guide

Fine-tune how the agent searches for and uses knowledge:

| Setting | Too Low | Too High | Start With |
|---------|---------|----------|------------|
| **Top K** | Misses relevant context | Response is slow, includes noise | 8 |
| **Candidate K** | Misses relevant chunks during search | Slower retrieval | 40 |
| **Max Citations** | Users want to verify but can't | Cluttered response | 3 |
| **Similarity Threshold** | Irrelevant chunks included | Too strict, misses valid content | 0.5 |

**Tuning workflow:**
1. Chat with the agent and note issues
2. If answers miss relevant info → increase **Top K** or decrease **Similarity Threshold**
3. If answers include irrelevant info → increase **Similarity Threshold** or decrease **Top K**
4. If responses are slow → decrease **Top K** and **Candidate K**
5. Re-test after each change

---

## Tips

- **Test iteratively** — Chat with your agent after every prompt change
- **Start simple** — Use Simple RAG first. Only switch to Advanced if simple doesn't work well enough.
- **Attach relevant KBs only** — Don't attach every KB. Irrelevant content adds noise.
- **One agent per use case** — A "Support Bot" and a "Sales Bot" should be separate agents with different prompts and KBs
- **Use test suites** — Set up automated tests to catch regressions when you change prompts or retrieval settings (see [Test Suites](./07-test-suites.md))
- **Monitor analytics** — Check which agents are used most and their error rates
- **Enable citations** — Users trust answers more when they can verify sources
