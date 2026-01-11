Below is the **full, consolidated PRD** for your product, incorporating every decision we locked. This is written so it can be handed directly to engineering, product, or investors without reinterpretation.

---

# Product Requirements Document (PRD)

## Multi-Tenant AI Knowledge & Conversational Platform

---

## 1. Overview

### Product Vision

Build a **multi-tenant SaaS platform** that allows organizations to ingest knowledge from websites and documents, structure it into searchable knowledge bases, and deploy AI-powered conversational agents via an admin UI, public APIs, and an embeddable web widget.

The product combines:

* **Onyx-style knowledge ingestion and RAG**
* **Botpress-style agent configuration and deployment**
* **Enterprise-grade multi-tenancy, RBAC, and observability**

The system must also be **self-hostable** using the same codebase.

---

## 2. Goals and Non-Goals

### Goals

* Allow tenants to scrape websites (HTML + JS-rendered)
* Allow tenants to upload documents (text extraction only)
* Build searchable knowledge bases with metadata-enriched chunks
* Provide configurable AI agents using strict RAG
* Deploy agents via admin UI, public REST API, and embeddable widget
* Ensure strong tenant isolation and no cross-user data leakage
* Scale to **100–1k tenants**

### Non-Goals (v1)

* OCR
* Fine-tuning models
* Multimodal (images/audio)
* Authenticated end-users in widget
* Workflow automation
* Human handoff
* Storing full chat transcripts

---

## 3. Target Users

### Primary

* SaaS companies embedding AI assistants
* Internal platform teams
* Documentation/support teams

### Secondary

* Enterprises building internal copilots
* Developers building AI-powered products

---

## 4. Deployment Model

* **Primary:** Managed SaaS
* **Secondary:** Self-hosted (Docker Compose or Kubernetes)

Same codebase, configurable storage and auth.

---

## 5. Authentication & Authorization

### Authentication

* **OIDC only**
* User identity key: `issuer + subject` (primary), email secondary
* No local passwords

### Authorization (RBAC)

Tenant roles:

* Owner
* Admin
* Member
* Viewer

System role:

* System Admin (manages global KBs)

Permissions (v1):

* **Owner + Admin**:

  * Create/modify KBs
  * Add sources
  * Create/modify agents
  * Configure widgets
  * View analytics (metadata only)

---

## 6. Multi-Tenancy & Isolation

* Shared Postgres database
* `tenant_id` present on all tenant-owned records
* **Postgres Row-Level Security (RLS)** enforced
* System Admin bypass via controlled DB role/context
* No data leakage across tenants

---

## 7. Knowledge Model

### Hierarchy

```
Tenant
 ├── Knowledge Bases
 │    ├── Sources (scrapes/uploads)
 │    │    └── Source Runs
 │    │         └── Pages → Chunks → Embeddings
 └── Agents
      └── Attached Knowledge Bases
```

### Global Knowledge Bases

* Created and published only by System Admins
* Tenants can subscribe/unsubscribe
* Read-only for tenants

---

## 8. Knowledge Ingestion

### 8.1 Website Scraping

#### Supported Modes

* Single page
* List of URLs
* Sitemap
* Domain crawl

#### Capabilities

* HTML fetch first
* JS rendering via Playwright fallback
* Optional Firecrawl fallback (per source toggle)
* Configurable:

  * Crawl depth
  * Include/exclude paths
  * Subdomain inclusion
  * Rate limits (per tenant)
* URL normalization:

  * Strip common tracking params (`utm_*`, `gclid`, etc.)
* Content type:

  * HTML only (v1)

#### Scheduling

* Daily or weekly
* Manual “run now”

#### Change Detection

* Hash extracted text
* Re-embed only on change

---

### 8.2 Document Uploads

#### Supported Formats

* PDF
* DOCX
* TXT
* Markdown
* HTML

#### Behavior

* Extract text only
* Original files not persisted
* Async ingestion
* Subject to monthly quotas

---

## 9. Ingestion Pipeline

### Queue System

* **Redis-backed queue**
* Separate worker services

### Job Types

* Source run start
* URL discovery
* Page fetch
* Page processing
* Chunk embedding
* Optional LLM enrichment
* Run finalization
* Scheduled hard deletes

### Reliability

* 3 retries with exponential backoff
* Best-effort latency (minutes acceptable)
* Partial success allowed

---

## 10. Chunking & Embeddings

### Chunking Defaults

* Chunk size: **800 tokens**
* Overlap: **120 tokens**

### Embeddings

* Single system-configured **OpenAI-compatible embedding model**
* Stored in **pgvector**
* One shared embeddings table with metadata filters

### Metadata Stored Per Chunk

* Title
* URL
* Heading / section path
* Language
* Tags
* Entities
* Keywords
* Summary
* Content hash

### Enrichment

* LLM-based enrichment
* **Toggleable per KB/source**
* Cached by content hash

---

## 11. Retrieval & RAG

### Retrieval Strategy

* **Hybrid retrieval**

  * Vector similarity (pgvector)
  * Keyword search (Postgres `tsvector`)
* Candidate pool merged and reranked

### Reranking

* Default: **heuristic reranker**
* Optional: cross-encoder reranker (toggle per agent)

### RAG Policy

* **Strict**

  * Answer only from provided sources
  * If insufficient: “I don’t know based on the provided sources”

### Citations

Each response includes:

* Title
* URL
* Quoted snippet

---

## 12. Agents

### Agent Capabilities

* Custom system prompt
* Attached KBs (many)
* Reranker on/off
* Citation on/off

### Deployment Targets

* Admin UI chat
* Public REST API
* Embeddable web widget

---

## 13. Widget

### Delivery

* Single `<script>` injector

### Access

* Public (no end-user auth)
* Controlled by:

  * Public widget token
  * Domain allowlist (Origin + Referer)
  * Per-tenant rate limiting

### Session & Memory

* conversation_id stored in **sessionStorage**
* Memory:

  * Last **20 turns**
  * TTL **1 hour**
* Stored in Redis
* Scoped by `tenant_id + agent_id + conversation_id`
* No cross-visitor leakage

---

## 14. API

### Versioning

* `/v1/*`

### Auth Modes

* OIDC bearer tokens (admin/user)
* API keys (server-to-server, widget)

### Core Endpoints

* Tenants & memberships
* Knowledge bases & subscriptions
* Sources & runs
* Uploads
* Agents & retrieval config
* Widget config & chat
* Analytics (metadata only)

---

## 15. Quotas & Limits (Defaults)

* KBs per tenant: **10**
* Agents per tenant: **10**
* Uploaded docs/month: **1000**
* Scraped pages/month: **1000**
* Crawl concurrency/tenant: **5**
* Per-tenant rate limiting on chat endpoints

(All configurable by plan/admin.)

---

## 16. Logging & Analytics

### Stored

* Timestamps
* Latency
* Token counts
* Retrieval stats
* Error codes

### Not Stored

* Chat transcripts
* User message content (beyond in-memory session TTL)

SOC2-ready design.

---

## 17. Deletion & Retention

* Soft delete by default
* Hard delete after **30 days**
* Async cleanup of:

  * Chunks
  * Embeddings
  * Metadata
* Deletion jobs tracked explicitly

---

## 18. Non-Functional Requirements

### Performance

* Chat p50 < 2s
* Async ingestion

### Scalability

* Horizontal scaling for:

  * API
  * Workers
  * Scrapers

### Security

* Tenant isolation (RLS)
* Encrypted storage
* API key rotation
* Least-privilege access

### Observability

* Structured logs
* Metrics per tenant
* Job failure alerts

---

## 19. MVP Definition

v1 is complete when:

* A tenant can scrape a JS-rendered site
* A tenant can upload documents
* Content is searchable via RAG
* An agent can be deployed via widget
* No data leaks between tenants or widget visitors

---

## 20. Success Metrics

* Time to first answer < 5 minutes from ingestion
* <5% unanswered queries
* Zero cross-tenant incidents
* Stable operation at 100–1k tenants

---

If you want, next logical steps are:

* Turn this into **engineering epics & milestones**
* Produce a **first-pass system architecture diagram**
* Generate **repo structures and service skeletons**
* Write **initial SQL migrations**
* Create **Playwright scraping implementation**

Tell me which one you want next.
