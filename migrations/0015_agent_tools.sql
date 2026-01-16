-- Migration: Add agentic capabilities and tools
-- Purpose: Support agentic mode with multi-KB routing, external API tools, and MCP

-- ============================================================================
-- Agent Capabilities Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    
    -- Mode toggles
    agentic_mode_enabled BOOLEAN NOT NULL DEFAULT false,
    multi_kb_routing_enabled BOOLEAN NOT NULL DEFAULT false,
    tool_calling_enabled BOOLEAN NOT NULL DEFAULT false,
    max_tool_calls_per_turn JSONB NOT NULL DEFAULT '5',
    multi_step_reasoning_enabled BOOLEAN NOT NULL DEFAULT false,
    max_reasoning_steps JSONB NOT NULL DEFAULT '3',
    show_chain_of_thought BOOLEAN NOT NULL DEFAULT true,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT agent_capabilities_agent_unique UNIQUE (agent_id)
);

-- ============================================================================
-- Tool Definitions Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS tool_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Tool identification
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    
    -- Tool type: 'api', 'mcp', 'builtin'
    type TEXT NOT NULL,
    
    -- Type-specific configuration (JSON)
    config JSONB NOT NULL,
    
    -- Parameters schema (JSON Schema format)
    parameters JSONB NOT NULL DEFAULT '[]',
    
    -- Status
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    
    -- Metadata
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tool_definitions_tenant_idx ON tool_definitions(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS tool_definitions_name_unique 
    ON tool_definitions(tenant_id, name) 
    WHERE deleted_at IS NULL;

-- ============================================================================
-- Agent Tools Junction Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tool_id UUID NOT NULL REFERENCES tool_definitions(id) ON DELETE CASCADE,
    
    -- Per-agent settings
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    priority JSONB NOT NULL DEFAULT '100',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_tools_unique 
    ON agent_tools(agent_id, tool_id) 
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS agent_tools_agent_idx ON agent_tools(agent_id);
CREATE INDEX IF NOT EXISTS agent_tools_tool_idx ON agent_tools(tool_id);

-- ============================================================================
-- MCP Connections Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS mcp_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Connection identification
    name TEXT NOT NULL,
    description TEXT,
    
    -- MCP configuration
    config JSONB NOT NULL,
    
    -- Connection status
    status TEXT NOT NULL DEFAULT 'disconnected',
    last_error TEXT,
    last_connected_at TIMESTAMPTZ,
    
    -- Available tools from this server
    available_tools JSONB NOT NULL DEFAULT '[]',
    
    -- Status
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    
    -- Metadata
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS mcp_connections_tenant_idx ON mcp_connections(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_connections_name_unique 
    ON mcp_connections(tenant_id, name) 
    WHERE deleted_at IS NULL;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE agent_capabilities IS 'Controls agentic features per agent (multi-KB routing, tool calling, reasoning)';
COMMENT ON TABLE tool_definitions IS 'Reusable tool configurations at tenant level (API endpoints, MCP servers, built-ins)';
COMMENT ON TABLE agent_tools IS 'Links tools to agents with per-agent settings';
COMMENT ON TABLE mcp_connections IS 'Persistent connections to MCP (Model Context Protocol) servers';
