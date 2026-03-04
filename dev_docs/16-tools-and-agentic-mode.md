# Tools & Agentic Mode

Grounded supports an agentic architecture where agents can go beyond simple RAG — they can call external APIs, use built-in utilities, and connect to MCP (Model Context Protocol) servers. This document covers the tools system, agent capabilities, and how they integrate.

## Overview

The tools system has four layers:

```
Agent Capabilities (per-agent feature toggles)
    ↓ enables
Tool Definitions (tenant-level reusable tool configs)
    ↓ attached via
Agent Tools (junction: which tools an agent can use)
    ↓ executed by
Tool Runtime (API calls, MCP connections, built-in functions)
```

---

## Data Model

### Agent Capabilities (`agent_capabilities`)

**Schema:** `packages/db/src/schema/tools.ts`

Per-agent feature flags that control what agentic behaviors are enabled:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `agentic_mode_enabled` | boolean | false | Master toggle for agentic features |
| `multi_kb_routing_enabled` | boolean | false | Let agent choose which KB to query per question |
| `tool_calling_enabled` | boolean | false | Allow agent to call external tools |
| `max_tool_calls_per_turn` | number | 5 | Cap on tool invocations per user message |
| `multi_step_reasoning_enabled` | boolean | false | Allow multi-step tool chains |
| `max_reasoning_steps` | number | 3 | Cap on reasoning iterations |
| `show_chain_of_thought` | boolean | true | Show reasoning steps to the user |

**Unique constraint:** One capabilities record per agent.

### Tool Definitions (`tool_definitions`)

**Schema:** `packages/db/src/schema/tools.ts`

Tenant-level reusable tool configurations. A tool is defined once and can be attached to multiple agents.

| Column | Type | Purpose |
|--------|------|---------|
| `tenant_id` | uuid | Owner tenant |
| `name` | text | Unique name within tenant (used for LLM function calling) |
| `description` | text | Description sent to LLM for tool selection |
| `type` | `"api" \| "mcp" \| "builtin"` | Tool type |
| `config` | jsonb | Type-specific configuration (see below) |
| `parameters` | jsonb | Tool parameter schema (JSON Schema format for LLM) |
| `is_enabled` | boolean | Active/inactive toggle |

**Unique constraint:** `(tenant_id, name)` where not deleted.

### Agent Tools (`agent_tools`)

Junction table linking tools to agents:

| Column | Type | Purpose |
|--------|------|---------|
| `agent_id` | uuid | The agent |
| `tool_id` | uuid | The tool definition |
| `is_enabled` | boolean | Per-agent enable/disable |
| `priority` | number | Lower = higher priority for tool selection (default: 100) |

### MCP Connections (`mcp_connections`)

Persistent MCP server configurations:

| Column | Type | Purpose |
|--------|------|---------|
| `tenant_id` | uuid | Owner tenant |
| `name` | text | Unique connection name |
| `config` | jsonb | MCP transport config (stdio, sse, websocket) |
| `status` | text | `connected`, `disconnected`, `error` |
| `available_tools` | jsonb | Tools discovered from the MCP server |

---

## Tool Types

### 1. API Tools (`type: "api"`)

Call external HTTP APIs. Configuration:

```typescript
interface ApiToolConfig {
  baseUrl: string;              // e.g., "https://api.example.com"
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;                 // e.g., "/v1/search/{query}" (param placeholders)
  auth: {
    type: "none" | "api_key" | "bearer" | "basic" | "custom_header";
    headerName?: string;        // For api_key / custom_header
    secret?: string;            // The actual credential
    username?: string;          // For basic auth
  };
  headers?: Record<string, string>;
  bodyTemplate?: string;        // JSON template for POST/PUT/PATCH
  responseFormat?: "json" | "text";
  timeoutMs?: number;
}
```

**Use cases:** CRM lookups, inventory checks, ticket creation, custom business APIs.

### 2. MCP Tools (`type: "mcp"`)

Connect to Model Context Protocol servers:

```typescript
interface McpToolConfig {
  transport: "stdio" | "sse" | "websocket";
  command?: string;             // For stdio: executable path
  args?: string[];              // For stdio: command arguments
  env?: Record<string, string>; // For stdio: environment variables
  url?: string;                 // For sse/websocket: server URL
  connectionOptions?: Record<string, unknown>;
}
```

**Use cases:** Local tools (file systems, databases), external MCP servers, IDE integrations.

### 3. Built-in Tools (`type: "builtin"`)

Pre-packaged tools that ship with Grounded:

| Tool | `toolType` | Description | Config Required |
|------|-----------|-------------|:-:|
| **Multi-KB Router** | `multi_kb_router` | Intelligently routes queries to the most relevant KB | No |
| **Calculator** | `calculator` | Mathematical calculations | No |
| **Date & Time** | `date_time` | Current date/time and date math | No |
| **Web Search** | `web_search` | Real-time web search | Yes (API key) |

Built-in tools are listed via `GET /api/v1/tools/builtin`.

---

## Tool Parameters (for LLM Function Calling)

Each tool defines parameters in JSON Schema format that the LLM uses for function calling:

```typescript
interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}
```

These are sent to the LLM as the tool's function signature. The LLM generates structured arguments matching these parameters.

---

## API Reference

### Tool Definitions CRUD

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/v1/tools/builtin` | Bearer | List available built-in tools |
| `GET` | `/api/v1/tools` | Bearer + Tenant | List all tools for tenant |
| `GET` | `/api/v1/tools/:toolId` | Bearer + Tenant | Get single tool |
| `POST` | `/api/v1/tools` | Owner/Admin | Create tool |
| `PATCH` | `/api/v1/tools/:toolId` | Owner/Admin | Update tool |
| `DELETE` | `/api/v1/tools/:toolId` | Owner/Admin | Soft-delete tool |

### Agent Capabilities

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/v1/tools/agents/:agentId/capabilities` | Bearer + Tenant | Get agent capabilities |
| `PUT` | `/api/v1/tools/agents/:agentId/capabilities` | Owner/Admin | Update capabilities (upsert) |

### Agent Tools

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/v1/tools/agents/:agentId/tools` | Bearer + Tenant | List attached tools |
| `POST` | `/api/v1/tools/agents/:agentId/tools` | Owner/Admin | Attach tool to agent |
| `DELETE` | `/api/v1/tools/agents/:agentId/tools/:toolId` | Owner/Admin | Detach tool from agent |

**Route file:** `apps/api/src/routes/tools.ts` (463 lines)

---

## Configuration Workflow

### Setting Up a Tool

1. **Create a tool definition** at the tenant level:
```json
POST /api/v1/tools
{
  "name": "crm_lookup",
  "description": "Look up customer information by email or ID",
  "type": "api",
  "config": {
    "baseUrl": "https://crm.company.com/api",
    "method": "GET",
    "path": "/customers/{customerId}",
    "auth": { "type": "bearer", "secret": "crm-api-token" },
    "responseFormat": "json",
    "timeoutMs": 5000
  },
  "parameters": [
    {
      "name": "customerId",
      "type": "string",
      "description": "Customer ID or email address",
      "required": true
    }
  ]
}
```

2. **Enable agentic mode** on the agent:
```json
PUT /api/v1/tools/agents/{agentId}/capabilities
{
  "agenticModeEnabled": true,
  "toolCallingEnabled": true,
  "maxToolCallsPerTurn": 3
}
```

3. **Attach the tool** to the agent:
```json
POST /api/v1/tools/agents/{agentId}/tools
{
  "toolId": "uuid-of-crm-lookup",
  "isEnabled": true,
  "priority": 50
}
```

### Using Built-in Tools

1. Create a tool definition from a built-in template:
```json
POST /api/v1/tools
{
  "name": "calculator",
  "description": "Performs mathematical calculations",
  "type": "builtin",
  "config": { "toolType": "calculator" }
}
```

2. Enable capabilities and attach (same as above).

---

## File Map

| File | Purpose |
|------|---------|
| `packages/db/src/schema/tools.ts` | All tool-related tables and TypeScript types |
| `apps/api/src/routes/tools.ts` | Tool CRUD, capabilities, agent-tool attachment |
| `apps/api/src/modules/tools/schema.ts` | Zod validation schemas for tool routes |
| `apps/api/src/services/agent-helpers.ts` | `loadAgentForTenant()` used by tools routes |

---

## Current State & Future Direction

The tools infrastructure (schema, CRUD, capabilities) is fully built. The tool **execution runtime** (actually calling APIs, running MCP connections, executing built-in functions during chat) is the next implementation phase. The schema is designed to support:

- LLM function calling with tool parameters
- Multi-step reasoning chains with intermediate tool results
- Chain-of-thought visibility for users
- Priority-based tool selection when multiple tools are available
