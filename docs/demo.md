# The demo

`grounded demo` seeds a sample install: a **Demo** team whose agents answer questions about the Go programming language from the Go documentation. It is the quickest way to see Grounded working, and the README's screenshots come from it ([phase 5](phase5-deploy.md) F6).

There are two ways to run it:
- **With Docker only** ([`compose.demo.yaml`](../compose.demo.yaml)): everything on your machine, no model keys. Start here.
- **On an install you already run**: `grounded demo` adds the Demo team to it (see "Seeding an existing install").

## Try it with Docker

```sh
git clone https://github.com/ncecere/grounded.git
cd grounded
docker compose -f compose.demo.yaml up --build     # or: make demo
```

1. The first start builds the image (a few minutes), then starts Postgres, Valkey, Grounded (`grounded serve`: the API, the UI and the worker) and the `demo` service.
2. The `demo` service runs `grounded demo` with the built-in fake models, then keeps serving them.
3. The worker crawls about 100 pages of https://go.dev/doc/ and indexes them. This takes about two minutes; the source's page shows the progress.
4. Open http://localhost:8080 and sign in as **Dev Platform Admin**. Home lists the two agents. Open **Go docs assistant** and pick a starter question.

The fake model is not a language model. Each answer starts with *"Demo model: this is a canned answer, not a real language model"* and quotes the three passages that best match the question, with citations to the Go documentation pages. Retrieval, citations, conversations and the rest of the UI are real.

**For your machine only.** This setup uses development sign-in (anyone who reaches the page can pick any persona) and the public example keys from `.env.example`. Grounded accepts both only because `APP_URL` is a loopback address, and the compose file publishes the UI on 127.0.0.1 only. Don't expose it or use it as the basis of a real install; see [`deployments/`](deployments/README.md) instead.

| Task | Command |
|---|---|
| Use another port | `GROUNDED_DEMO_PORT=8081 docker compose -f compose.demo.yaml up` |
| Stop, keeping the data | `docker compose -f compose.demo.yaml down` |
| Start again from scratch | `docker compose -f compose.demo.yaml down -v` |

Starting again with the data kept is quick: `grounded demo` finds the Demo team, prints "already seeded" and adds nothing. The source syncs weekly.

### Real models

To see real answers, start from scratch with an OpenAI-compatible gateway (LiteLLM, vLLM, a hosted API and so on):

```sh
docker compose -f compose.demo.yaml down -v
export DEMO_MODELS=openai-compatible DEMO_SERVE_FAKE_MODELS=false
export DEMO_CHAT_URL=https://gateway.example.edu/v1 DEMO_CHAT_KEY=sk-... DEMO_CHAT_MODEL=<chat model>
export DEMO_EMBED_MODEL=<embedding model>          # same gateway and key unless DEMO_EMBED_URL / DEMO_EMBED_KEY are set
docker compose -f compose.demo.yaml up --build
```

The `demo` service then seeds with real models and exits. A gateway on your own machine is `http://host.docker.internal:<port>/v1` from inside the containers. See "Models" below for the other variables.

## What `grounded demo` creates

| Object | Details |
|---|---|
| Crawl allowlist entry | `go.dev`, unless the allowlist already covers it |
| Models (only with `--models`) | A model connection, a chat model, an embedding model and an embedding profile (and optionally a SystemOne model); see "Models" |
| Team **Demo** (`demo`) | Its owner is the `--owner-email` account (see "The owner"). Maximum classification: the least sensitive level that allows web sources and signed-in audiences (`open` on a default install) |
| Web source **Go documentation** | Crawls `https://go.dev/doc/`: include prefix `/doc/`, depth 2, at most 100 pages, weekly. The first crawl starts at once |
| Knowledge base **Go documentation** | The web source attached |
| Agent **Go docs assistant** (`go-docs`) | Published to the team, with a welcome message and four starter questions |
| Agent **Go docs (signed-in)** (`go-docs-signed-in`) | Published to everyone who signs in (`all_authenticated`) |

It prints what it created and the agents' links, for example `http://localhost:8080/a/demo/go-docs`. The worker (`grounded serve` or `grounded worker`) does the crawling; answers get better as pages are indexed.

### Rules

- **Empty installs only.** It refuses when the install already has a team. `--force` adds the Demo team next to existing teams. If a team with the slug `demo` exists that the demo did not create, `--force` adds nothing at all.
- **It never changes existing data.** Every step only adds what is missing. Its embedding profile becomes the platform default only when it is the first profile.
- **Safe to run again.** It records the team it created (in `bootstrap_state`, key `demo_seed`). A later run finds it, adds whatever an interrupted run left out, and otherwise does nothing. Objects are found by name: the models by key (`demo-fake-chat`, `demo-chat`, ...), the connection, source and KB by name, the agents by slug.
- **Validated and audited like the UI.** It calls the same services as the API, acting as the owner, so the audit log names the owner for each object. One system entry, "Seeded the demo" (`demo.seed`), lists everything a run added.

### The owner

`--owner-email` (or `DEMO_OWNER_EMAIL`) picks the Demo team's owner. The account must exist, that is, the person has signed in once. Without the flag, the owner is:
1. the bootstrap admin (`BOOTSTRAP_ADMIN_SUBJECT`), if they have signed in;
2. otherwise, with `DEV_AUTH=true`, the development admin `admin@localhost`;
3. otherwise the only active platform admin, if there is exactly one.

With `DEV_AUTH=true`, a development persona that has not signed in yet is created as its first sign-in would create it (audited as `demo.owner_provision`). Its platform role is still granted at its first sign-in, as usual. This is what lets the Docker demo seed before anyone has signed in.

## Models

| `--models` | What the agents use |
|---|---|
| (not given) | The install's default embedding profile and its first usable chat model. Nothing is created; if there are none, it stops and suggests `--models=fake` |
| `fake` | The built-in fake gateway at `--fake-url`: a connection "Demo models (fake)", the chat model "Demo model (canned answers)", 768-dimension fake embeddings and a profile "Demo (fake embeddings)" |
| `openai-compatible` | A real gateway: a connection "Demo models" (or one each for chat and embeddings when they differ), the chat and embedding models, and a profile "Demo embeddings" |

For `openai-compatible`:

| Flag | Variable | |
|---|---|---|
| `--chat-url` | `DEMO_CHAT_URL` | Required. The gateway's base URL, including `/v1` |
| `--chat-key` | `DEMO_CHAT_KEY` | The gateway's API key |
| `--chat-model` | `DEMO_CHAT_MODEL` | Required. The chat model ID |
| `--embed-model` | `DEMO_EMBED_MODEL` | Required. The embedding model ID |
| `--embed-url`, `--embed-key` | `DEMO_EMBED_URL`, `DEMO_EMBED_KEY` | Default: the chat ones |
| `--embed-dims` | `DEMO_EMBED_DIMS` | Default: asked from the gateway with one embedding request |
| `--systemone-model` | `DEMO_SYSTEMONE_MODEL` | Optional: adds a SystemOne model on the chat gateway. Turn the checks on under Admin → SystemOne |

Every flag has a `DEMO_*` variable (the flag name in capitals, `-` as `_`); a flag on the command line wins. Prefer the variables for keys: command lines are visible to other users of the machine, and `--help` never prints the variables' values. Keys are stored encrypted, like keys entered in the admin UI.

### The fake gateway

`grounded demo --serve-fake-models` seeds with `--models=fake`, then serves the fake gateway on `--fake-addr` (default `127.0.0.1:8090`) until it is stopped. Grounded reaches it at `--fake-url`, by default `http://<fake-addr>/v1`; in the compose file it is `http://demo:8090/v1`. Keep it running: the agents need it for every answer, and the worker for every page it indexes.

It serves `GET /v1/models`, `POST /v1/embeddings` (model `grounded-demo-embed`: a hashed bag of words, so texts sharing words are close) and `POST /v1/chat/completions` (model `grounded-demo-chat`, JSON or streamed): a query rewrite gets the question back, and an answer quotes the retrieved passages under the "Demo model" label, or gives the agent's refusal message when nothing was retrieved. Its key is `sk-grounded-demo-fake`; it protects nothing, because the gateway holds no data.

`--fake-word-delay` (`DEMO_FAKE_WORD_DELAY`, default `0`) pauses between the words of every chat reply, streamed or not, for example `20ms`. The load tests use it to hold answers open the way a real model's generation does ([`benchmarks/load.md`](benchmarks/load.md)).

The developer fake gateway (`make fake-proxy`, `cmd/fakeproxy`) is a different tool, for tests and UI work; the demo doesn't use it.

## Seeding an existing install

On a development checkout (`make deps-up`, `make run`), in another terminal:

```sh
set -a && . ./.env && set +a
./bin/grounded demo --serve-fake-models          # add --force if the install already has teams
```

The fake gateway listens on 127.0.0.1:8090, like `make fake-proxy`: stop that first, or add `--fake-addr 127.0.0.1:8091`.

On a real install, run `grounded demo` with the install's configuration (the same environment as `grounded worker`), for example as a one-off Kubernetes Job or `kubectl exec` into a worker pod, with `--owner-email` and `--models=openai-compatible` or the install's own models. The demo's source crawls go.dev, so the install needs outbound HTTPS to it. Everything it creates is ordinary data: change or delete the Demo team, its agents and the models like any others.
