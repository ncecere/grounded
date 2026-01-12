# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-01-11

### Added

- **Multi-tenant Architecture**: Full multi-tenancy support with row-level security (RLS) for complete data isolation between organizations.
- **Knowledge Base Management**: Create and manage knowledge bases with web crawling and file upload support.
- **Web Crawling**: Automated content ingestion from websites with multiple crawl modes:
  - Single page crawling
  - Sitemap-based crawling
  - Full domain crawling with depth control
  - URL pattern filtering (include/exclude)
  - Scheduled re-crawling (daily, weekly, monthly)
- **File Uploads**: Support for PDF, Word, Excel, PowerPoint, text, HTML, CSV, and JSON files.
- **AI Agents**: Configurable chat agents with:
  - Custom system prompts
  - Multiple LLM provider support (OpenAI, Anthropic, Google, OpenAI-compatible)
  - Retrieval configuration (top-k, reranking, citation settings)
  - Welcome messages and branding
- **RAG Pipeline**: Strict retrieval-augmented generation ensuring responses are grounded in knowledge base content with proper citations.
- **Vector Search**: Semantic search using pgvector with support for multiple embedding models.
- **Chat Widget**: Embeddable Preact-based chat widget with:
  - Customizable appearance
  - Domain restrictions
  - Streaming responses
  - Citation display
  - Conversation persistence
- **Hosted Chat Pages**: Standalone chat pages accessible via shareable URLs.
- **REST API**: Full API for programmatic access with:
  - Streaming and non-streaming chat endpoints
  - Conversation management
  - Token-based authentication
- **User Management**:
  - Local authentication with email/password
  - SSO support via OpenID Connect
  - Role-based access control (Admin, Member, Viewer)
- **Team Management**: Invite team members, assign roles, and manage access.
- **Analytics Dashboard**: Query volume, response times, and usage metrics.
- **Admin Panel**: System-wide configuration for:
  - LLM provider management
  - Tenant administration
  - User management
  - Shared knowledge bases

### Infrastructure

- Docker Compose deployment configuration
- Kubernetes manifests for production deployment
- PostgreSQL with pgvector for vector storage
- Redis for job queue (BullMQ)
- Background workers for ingestion and web scraping

### Documentation

- Development setup guide
- Architecture documentation
- Deployment guides (Docker, Kubernetes)
- User documentation for administrators and tenants
- API integration guides

[unreleased]: https://github.com/ncecere/grounded/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ncecere/grounded/releases/tag/v0.1.0
