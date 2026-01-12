# Grounded User Documentation

Welcome to the Grounded user documentation. This guide covers everything you need to deploy, configure, and use the Grounded platform.

## What is Grounded?

Grounded is an enterprise RAG (Retrieval-Augmented Generation) platform that enables organizations to build AI-powered chat agents backed by their own knowledge bases. The platform emphasizes **strict RAG with no hallucinations** - every response is grounded in your knowledge sources with full citation support.

### Key Features

- **Knowledge Base Management**: Ingest content from websites, documents, and files
- **AI Chat Agents**: Configure custom agents with specific knowledge and personalities
- **Multi-Tenant Architecture**: Isolate data and users across organizations
- **Embeddable Widget**: Add chat to any website with a simple JavaScript snippet
- **API Access**: Integrate chat capabilities into your applications
- **Analytics**: Track usage, performance, and user interactions
- **Multiple LLM Support**: Use OpenAI, Anthropic, Google, or custom providers

## Documentation Sections

### Deployment

Step-by-step guides for deploying Grounded in various environments.

- **[Quick Start with Docker](./deployment/docker.md)** - Get running in minutes
- **[Kubernetes Deployment](./deployment/kubernetes.md)** - Production-grade deployment
- **[Configuration Reference](./deployment/configuration.md)** - All configuration options
- **[SSL/TLS Setup](./deployment/ssl.md)** - Secure your deployment

### System Administration

Guides for system administrators managing the Grounded platform.

- **[Initial Setup](./administration/getting-started.md)** - First-time configuration
- **[User Management](./administration/user-management.md)** - Managing users and access
- **[Tenant Management](./administration/tenant-management.md)** - Multi-tenant configuration
- **[AI Model Configuration](./administration/model-configuration.md)** - Setting up LLM providers
- **[System Settings](./administration/system-settings.md)** - Global configuration
- **[Shared Knowledge Bases](./administration/shared-knowledge-bases.md)** - Global KB management
- **[Monitoring & Alerts](./administration/monitoring.md)** - Health checks and notifications

### Tenant User Guide

Documentation for tenant users (owners, admins, and members).

- **[Getting Started](./tenant-guide/getting-started.md)** - Tenant overview
- **[Knowledge Bases](./tenant-guide/knowledge-bases.md)** - Creating and managing KBs
- **[Data Sources](./tenant-guide/sources.md)** - Adding web and document sources
- **[Agents](./tenant-guide/agents.md)** - Configuring chat agents
- **[Team Management](./tenant-guide/team-management.md)** - Managing team members
- **[Analytics](./tenant-guide/analytics.md)** - Understanding your usage

### Integration

Guides for integrating Grounded into your applications.

- **[Chat Widget](./integration/widget.md)** - Embed chat on your website
- **[REST API](./integration/api.md)** - Programmatic access
- **[Hosted Chat Pages](./integration/hosted-chat.md)** - Standalone chat URLs
- **[Webhooks](./integration/webhooks.md)** - Event notifications

## Quick Links

| I want to... | Go to... |
|--------------|----------|
| Deploy Grounded quickly | [Docker Quick Start](./deployment/docker.md) |
| Set up for production | [Kubernetes Deployment](./deployment/kubernetes.md) |
| Configure my first tenant | [Initial Setup](./administration/getting-started.md) |
| Add AI model providers | [Model Configuration](./administration/model-configuration.md) |
| Create a knowledge base | [Knowledge Bases](./tenant-guide/knowledge-bases.md) |
| Set up a chat agent | [Agents](./tenant-guide/agents.md) |
| Add chat to my website | [Chat Widget](./integration/widget.md) |
| Use the API | [REST API](./integration/api.md) |

## User Roles

Grounded has two levels of access control:

### System Level

| Role | Description |
|------|-------------|
| **System Admin** | Full platform access, can manage all tenants, users, and settings |

### Tenant Level

| Role | Description |
|------|-------------|
| **Owner** | Full tenant control, billing, can delete tenant |
| **Admin** | Manage team, knowledge bases, agents, and settings |
| **Member** | Create and manage own content |
| **Viewer** | Read-only access to tenant resources |

## Support

- **Documentation**: You're reading it!
- **GitHub Issues**: Report bugs and request features
- **Community**: Join discussions and get help

---

Next: [Docker Deployment](./deployment/docker.md)
