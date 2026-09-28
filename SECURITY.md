# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately**. Don't open a public issue, pull request or discussion.

Use GitHub's private vulnerability reporting: **[Report a vulnerability](https://github.com/ncecere/grounded/security/advisories/new)** on the repository's Security tab. The report is visible only to the maintainers, and we work on the fix with you in a private advisory.

Include:
- the affected version or commit;
- what an attacker can do, and what they need first (an account, a team role, an API key, network position);
- steps or a proof of concept to reproduce it;
- any suggested fix.

Grounded currently has one maintainer. We aim to reply within 5 business days and to agree a disclosure date with you once we understand the problem. We credit reporters in the fix's release notes unless you'd rather we didn't. Please give us reasonable time to fix the problem before you disclose it, and don't access or change data that isn't yours while testing.

## Supported versions

Grounded is pre-1.0. Security fixes are made on `main` and released as a patch of the latest minor release. Older minor releases don't get fixes, so upgrade to the latest release to receive them.

| Version | Supported |
|---|---|
| 0.1.x (latest patch) | Yes |
| Earlier pre-release builds | No |

Released images are signed. Verify an image before you deploy it, as the [release notes](docs/releases/v0.1.0.md#verifying-the-images) describe.

## Scope

In scope: the code in this repository, including
- `grounded` (API, worker, migrations) and its default configuration;
- the web UI in `web/`;
- the container image built from the `Dockerfile`;
- the example configuration in `.env.example` and `deploy/examples/`.

Areas we care most about:
- tenant isolation: one team reading or changing another team's content;
- bypassing roles, API key scopes or the classification rules (model, audience and team ceilings);
- access to conversation transcripts by anyone other than their owner, except a platform admin under break-glass with the conversations scope;
- platform admins reaching team content without break-glass, beyond a session's team, scope or time, or with any read left out of the audit log;
- the web crawler reaching private, loopback or link-local addresses (SSRF);
- prompt injection through retrieved content that leads to data exposure;
- authentication, session, CSRF and origin checks;
- leaks of secrets (gateway keys, API keys, OIDC secrets) in responses, logs or the UI.

Out of scope:
- a specific install's infrastructure, identity provider, model gateway or configuration choices (report those to the install's operator);
- the development-only login (`DEV_AUTH`), which is refused unless `APP_URL` is a loopback address;
- the development credentials in `compose.yaml` and `.env.example`;
- denial of service by volume alone, and findings that need a compromised host or database;
- vulnerabilities in dependencies with no demonstrated impact on this project (report them upstream; `make lint` runs govulncheck).

Operators: see [`docs/security/`](docs/security/README.md) for the data flow, controls, threat model and dependency inventory, [`docs/DESIGN.md`](docs/DESIGN.md) §16 for the security design, and your [deployment profile](docs/deployments/README.md) for your install's review status.
