# Grounded Roadmap

> Building an enterprise-ready, open-source RAG platform with agentic capabilities.

## Current Version: v0.1.0

---

## Priority Legend

- **P0** - Current focus (v0.2.0)
- **P1** - Next up (v0.3.0)
- **P2** - Future (v0.4.0+)

---

## P0 - Current Focus (v0.2.0)

### Agentic Mode for Agents

Enable agents to go beyond simple RAG with configurable tool-use capabilities.

**Scope:**
- Multi-KB routing: Agent intelligently selects which knowledge base(s) to query based on the question
- External API tools: Define custom REST/GraphQL endpoints the agent can call (with auth configuration)
- MCP integration: Connect to Model Context Protocol servers for extensible tool use
- Per-agent toggle: Simple RAG mode vs Agentic mode as a configuration option
- Tool configuration UI: Simple list-based interface for managing available tools per agent

---

### Transparent Chain-of-Thought UI

Show users what's happening during agentic responses to build trust and aid debugging.

**Scope:**
- Expandable "thinking" steps in chat UI (searching KB, calling tool, reasoning)
- Tool call indicators showing inputs and outputs
- Source retrieval visualization (which KBs were searched, chunks retrieved)
- Verbose mode toggle: Detailed view for power users vs clean view for end-users
- Real-time streaming of reasoning steps during response generation

---

### Audit Logs (Enterprise)

Track important actions for compliance and security.

**Scope:**
- Log authentication events (login, logout, failed attempts)
- Log resource mutations (create/update/delete for agents, KBs, sources, users)
- Log API key creation and usage
- Optional query logging (with privacy toggle per tenant)
- Audit log viewer in Admin UI with filtering and search
- Export capabilities (JSON download, webhook integration for SIEM)

---

## P1 - Next Up (v0.3.0)

### Answer Feedback & Quality Tracking

Collect and analyze response quality to improve agents over time.

**Scope:**
- Thumbs up/down feedback buttons on each chat response
- Store feedback with full conversation context for analysis
- Feedback dashboard: View low-rated answers, identify problem patterns
- Confidence scores: Display retrieval confidence (optional per-agent setting)
- Export feedback data for fine-tuning or external analysis

---

### Agent Test Suites

Define expected Q&A pairs to validate and monitor agent accuracy.

**Scope:**
- Create test cases: question + expected answer (or key phrases/semantics to match)
- Run test suites on-demand against any agent
- Scheduled test runs (daily, weekly) with alerting on regressions
- Pass/fail reporting with similarity scores and diff view
- Track accuracy trends over time as retrieval settings are tuned
- CI/CD integration: API endpoint to run tests in deployment pipelines

---

### Better-Auth Migration + SSO

Replace current auth system with better-auth for enterprise identity management.

**Scope:**
- Migrate from current auth to better-auth library
- Local authentication (email/password) - maintain current functionality
- Generic OIDC support (Google, GitHub, Azure AD, Okta, etc.)
- SAML 2.0 support for enterprise SSO requirements
- Per-tenant auth configuration (tenant A uses SAML, tenant B uses OIDC)
- Session management and token refresh improvements

---

## P2 - Future (v0.4.0+)

### Rate Limiting & Usage Quotas

Essential for fair use and resource management in multi-tenant deployments.

**Scope:**
- Per-tenant limits: Queries/day, tokens/month, sources per KB
- Per-API-key limits: For widget and API consumers
- Usage dashboard: Visualize consumption trends per tenant
- Configurable soft vs hard limits (warn at threshold, block at limit)
- Redis-backed enforcement at API layer
- Admin override capabilities for limit adjustments

---

### White-Label Support

Enable full customization of both widget and admin UI for resellers and agencies.

**Widget White-Labeling:**
- Remove or replace "Powered by Grounded" branding
- Custom CSS injection for full style control
- Custom domain support: Serve widget from tenant's domain
- Extended theming: Logo, colors, fonts, custom icons

**Admin UI White-Labeling:**
- Custom branding (logo, app name, favicon)
- Theme customization (colors, typography)
- Custom domain for admin portal
- Hide/show features based on tenant configuration

---

## Completed

### v0.1.0
- Core RAG pipeline with hybrid retrieval (vector + keyword)
- Multi-tenant architecture with row-level security
- Web scraping with Playwright
- Embeddable chat widget
- Admin UI for managing tenants, agents, knowledge bases, and sources
- Dark mode support with semantic CSS variables
- Reusable component library (PageHeader, StatCard, InfoBox, etc.)

---

## Contributing

We welcome contributions! If you're interested in working on any roadmap item:

1. Check the [Issues](https://github.com/your-org/grounded/issues) for existing discussions
2. Open a new issue to discuss your approach before starting work
3. Reference the roadmap item in your PR description

---

*Last updated: January 2025*
