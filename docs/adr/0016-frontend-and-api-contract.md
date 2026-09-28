# ADR-0016: Frontend and API contract

- Status: Accepted
- Date: 2026-09-24 (revised 2026-09-25: own component library on Base UI + CSS Modules)

> **Note (2026-09-26, 2026-09-27):** Institution branding was made opt-in, then removed: `neutral` is the only theme, and branding comes from `INSTANCE_NAME`, `ORG_NAME` and `UI_LOGO_URL`. See [ADR-0018](0018-open-source-institution-neutral.md) and [ADR-0023](0023-no-institution-data-in-the-repository.md).

## Context

The UI and the API are both first-class. The same `/v1` routes serve browser sessions, API keys and OpenAI-compatible clients (DESIGN.md §14). The UI is embedded in the Go binary (ADR-0001). As a public university service, it must meet WCAG 2.1 AA (ADA Title II). We also need an embeddable widget for public and authenticated agents that third-party pages can't break or restyle into inaccessibility.

## Decision

- **Frontend stack:** React 19, Vite and TypeScript, with TanStack Router and TanStack Query. It is built into static assets and embedded in the binary.
- **Component library (revised 2026-09-25):** we own a shadcn-style library in `web/src/ui/`. The source lives in the repo; it is not an installed package.
  - Behaviour and accessibility come from **Base UI** (`@base-ui/react`).
  - Styles are **CSS Modules** reading **semantic CSS custom properties** (design tokens in `ui/styles/tokens.css`, with a dark theme prepared). Variants are expressed as data attributes.
  - The look is a modern SaaS product (the quality of Linear, Vercel or Stripe), not stock shadcn: Inter, hairline borders with soft layered shadows, and the brand colour used sparingly.
  - A dev-only gallery at `/ui` is where the library is reviewed.
  - This replaces the earlier Radix + Tailwind choice.
- **Accessibility:** WCAG 2.1 AA throughout. Automated axe checks run in CI alongside frontend tests (ADR-0014). The tool is axe (vitest-axe and @axe-core/playwright). Base UI provides accessible primitives. Agent accent colours are contrast-checked.
- **Branding:** the institution's branding across the platform. Per-agent customization is limited to name, avatar, accent colour, welcome message and starter questions. **There is no custom CSS**, to protect accessibility.
- **Spec-first API contract:** an OpenAPI spec is written before handlers. It is 3.0.3 until oapi-codegen and kin-openapi fully support 3.1. A test fails if the served routes and the spec differ.
  - `oapi-codegen` generates the Go server interfaces and request/response types.
  - `openapi-typescript` generates the TypeScript client types used by the UI.
  - The spec encodes the conventions in DESIGN.md §14: `{ "data": ... }` for success, `{ "error": { "code", "message" } }` for errors, and 428/412 for missing or stale revisions.
  - Chat streaming (SSE) and the OpenAI-compatible endpoints are described in the spec as far as OpenAPI allows.
- **Widget as an iframe loader.** A small script placed on the host page injects an iframe that loads the agent's chat UI from our origin by stable ID (`/a/id/{uuid}`). It authenticates with a publishable agent key restricted to allowed origins (ADR-0012).

## Consequences

- One contract drives both the Go server and the TypeScript client, so type drift between them shows up at build time.
- The embedded UI ships in lockstep with the API it calls.
- An iframe isolates the widget's styles and scripts from the host page, which keeps it accessible and protects session and CSRF boundaries.
- **Costs and risks:**
  - Writing the spec first slows early prototyping and needs discipline to keep the spec as the source of truth.
  - `oapi-codegen` and `openapi-typescript` don't fully model SSE streams. Parts of the chat stream will be typed by hand.
  - Automated axe checks catch only part of WCAG. Manual and assistive-technology testing is still needed.
  - Iframes need care with sizing, focus management and cookies. Anonymous public use avoids third-party cookie problems, but authenticated widget use may run into browser cookie restrictions.
  - Frontend-only fixes need a full binary release (ADR-0001).

## Alternatives considered

- **Code-first API** (generating the spec from handlers). Rejected. The spec is the contract for UI and API users alike.
- **Hand-written TypeScript client types.** Rejected. They drift from the server.
- **A widget injected directly into the host page's DOM.** Not chosen. Host CSS and scripts could break accessibility and isolation.
