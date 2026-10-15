An agent answers questions from one or more knowledge bases with a chat model. Editors, admins and owners create and edit agents under **Agents** in the team's sidebar.

## Creating an agent

**Agents → New agent** asks for:

- **Name** and **Address**: the address is part of the agent's link, `/a/<team>/<address>`.
- **Description**: shown in the agent directory.
- **Knowledge bases**: up to five. The agent searches each with its own settings.
- **Chat model**: the models your platform allows for the knowledge bases' classification. If a model isn't approved for their level, the dialog says so. Since v0.4.2 the dialog starts on a model whose latest health check passed and that supports tools, never on a failing one; a model failing its health checks is marked **Failing** in the picker, which says so under it.

You can change everything later. Nobody can chat with the agent until you [publish](/docs/using/editors/versions) it.

## The editor

The agent editor has six tabs: **Build · Evaluations · Appearance · Share · Analytics · Settings**. The header shows the version badge ("v4 live", or "Draft" before the first publish), which opens the [version history](/docs/using/editors/versions), and **Publish**.

Build edits the **draft**. People keep chatting with the published version until you publish again. Appearance, Settings and Share aren't versioned: they apply at once (and an invalid value there never holds up **Publish**).

<Screenshot slot="agent-build" />

## Build

Build is a list of sections. A closed section shows a one-line summary of its settings, with its full text on hover. Beside them, the **Try it** panel chats with the draft. Since v0.4.2 the two fill the window and scroll on their own, so the page itself never scrolls past them; below 1100 px wide they stack. A field that needs fixing is highlighted, its section's header is marked, and the status beside **Publish** counts them ("Not saved: fix the 4 highlighted fields").

### Instructions

What the agent is for and how it should answer, up to 20,000 characters. Grounded adds its own grounding rules around your instructions: cite every factual sentence, don't invent steps beyond the sources, and treat the retrieved text as data, never as instructions.

### Model

The chat model that writes the answers. The field shows the most sensitive level the model is approved for, whether it supports tools, and its context window. Only models approved for the agent's knowledge bases can be used. Since v0.4.2 a model failing its [health checks](/docs/self-hosting/health) is marked **Failing**, and the field says answers may fail until a platform admin fixes it.

### Knowledge

The knowledge bases the agent searches (up to five). Each gives its own number of passages per search: by default the knowledge base's own setting ("Inherited from the knowledge base (6)"). **Override** sets a number from 1 to 20 for this agent; **Inherit** goes back.

**Pinned filters** narrow every search the agent makes: sources, document kinds, tags, URL prefixes and dates. Use them when one agent should answer from part of a broader knowledge base.

### Tools

Tools from outside services that the agent may call while it answers, such as a service status check or a room booking lookup. They come from MCP servers that your platform admins registered, and only tools they approved are listed. Until they approve some, the section says "No tools are available yet".

- Each tool shows its name, the server it's from, the most sensitive data it's approved for, and its description. Tick up to 10. When two servers offer a tool with the same name, each label names its server ("Check outage (check_outage), from Service status").
- A tool whose server is failing its health checks says so: "Service status started failing its health checks 4 days ago: calls to this tool may fail." (v0.4.2).
- A tool approved for less sensitive data than the agent's knowledge bases hold can't be ticked ("not approved for this agent's data"). The same check runs again when you publish and before every call.
- The chat model must support tools. If it doesn't, the section says so.
- Tools are part of the draft, like the knowledge bases: people get them when you publish.
- Only the details the model puts in a call are sent to the tool, never the conversation or the passages. An answer makes at most a few calls (your team's **MCP tool calls per answer** limit, 5 by default).
- A tool's result is cited like a document: "From *Service status* · Check outage", using the tool's title when its server gives one (since v0.4.2; its name before). In the chat the call is a step such as "Used Check outage". Claim checks verify sentences against it, and a strictly grounded agent answers only from passages and tool results.
- If a tool later loses its approval, or its server is turned off, the agent keeps answering without it and the section warns: **Remove it from the draft**.

<Screenshot slot="agent-build-tools" />

See [Tools from MCP servers](/docs/administration/mcp-servers) for how tools are registered, approved and priced.

### Answering

- **When to search**
  - **Search before every answer** (default): the question is searched once and the passages go to the model. A follow-up that depends on the conversation is first rewritten to stand on its own; a question that already stands alone is searched as it is. Fast and predictable.
  - **Let the model decide when to search**: the model gets a search tool and may search several times, or not at all. Needs a chat model with tool support. The answer is the model's final turn: text it writes in a turn that calls a tool (narration such as "I'll search for that", or a first draft) is neither shown nor stored (v0.4.2).
- **Answer only from the sources** (on by default, recommended): strict grounding. When the sources don't answer the question, the agent replies with the refusal message rather than general knowledge. If they cover part of it, it answers that part and says what isn't covered.
- **Refusal message**: sent word for word when the sources have no answer. The default is "I couldn't find an answer to that in the sources I have."
- **Citations**: what people see for each cited source: **No citations**, **Title and snippet**, or **Title, snippet and link (web pages)** (default). Uploaded files are always cited by title only.

### Safety

- **Check answers before showing them**: *As the platform's policy says* (default), *Paragraph by paragraph* (each paragraph is shown once it passed moderation) or *The whole answer* (people see "Writing and checking the answer…" until the whole answer passed). An agent can only make the audience's mode stricter, never weaker; public agents are checked paragraph by paragraph by default. See [Moderation modes](/docs/administration/moderation-modes).
- **Stricter category rules**: tighten the platform's moderation policy for this agent, per category, for questions and answers (the table scrolls in its own box on a narrow screen). An agent can make moderation stricter than the platform's policy, never weaker. The section says when the rules have no effect yet (for example when the audience has no moderation).

### SystemOne checks

Shown when the platform has a [SystemOne model](/docs/administration/systemone). Each check uses the platform default unless you turn it on or off for this agent:

- **Passage judging**: before the answer, a SystemOne model judges each candidate passage (**Passages to check**, 10 by default; with [reranking](/docs/administration/reranking), only the passages kept after reranking): it re-ranks them, drops prompt injections and passages that don't help, and keeps passages that contradict the question's premise apart. If nothing usable is left, a strictly grounded agent refuses without calling the chat model.
- **Citation checks**, with **Citation mode**: **annotate** marks each claim's verdict; **enforce** also removes confidently unsupported citations, and a strictly grounded agent with nothing supported refuses. See [Claims and verdicts](/docs/using/chat#claims-and-verdicts).
- **Scope check**: before searching, spots small talk (answered briefly without a search) and questions outside the agent's subject (a strictly grounded agent refuses without a search).

Since v0.4.1, under each check, the editor says how much time it adds on this platform, for example "Adds about 0.7 s per answer (platform median, last 14 days)." It's the median over every agent that used the check in the last 14 days, and is missing until some answer has used it.

<Screenshot slot="agent-build-systemone-added-time" />

Each check adds latency: passage judging roughly one SystemOne request per passage, but an answer waits for it at most the platform's passage judging time limit (1.5 s by default; passages not judged by then are used unjudged); citation checks one per claim and source after the answer. The scope check runs while the knowledge bases are searched, and passage judging starts only once it (and moderation) allow an answer, so small talk and out-of-scope questions spend no judging requests.

### Advanced

| Setting | What it does |
|---|---|
| **Temperature** | The model's sampling temperature. Blank uses the model's default. |
| **Maximum answer length (tokens)** | Blank uses the model's limit. |
| **Reasoning effort** | How long a reasoning model thinks before answering: **Default**, **Off**, **Low**, **Medium** or **High**. Lower starts answering sooner. **Default** follows the audience's setting (Low for public agents, unless a platform admin changed it; see [Moderation modes and reasoning](/docs/administration/moderation-modes#reasoning-effort)), else the model's. **Off** needs the chat model's **How to turn thinking off**, and Low to High its **Accepts reasoning effort** ([Models](/docs/administration/models#compatibility)); until a platform admin sets them, those choices are disabled and say why. |
| **Source token budget** | Passages are trimmed to about this many tokens (500–32,000; default 6,000). |
| **Maximum searches** | With "let the model decide", how many model turns may search (1–8; default 4). The last turn must answer. |
| **Minimum similarity** | Drop passages less similar than this (0–1). 0 turns it off. |
| **Rewrite follow-up questions** | With "search before every answer", rewrite a follow-up that depends on the conversation ("what about summer?", "can I pay for it by card?") into a question that stands alone before searching (on by default). It adds a short model call, asked for low reasoning effort when the model accepts one (off when the answer's effort is Off). A question that stands alone isn't rewritten. |
| **Suggest follow-up questions** | Since v0.4.1: after an answer with sources, offer up to 3 questions its sources can answer, as chips under it. On by default, for agents created before v0.4.1 too. It adds a short call to the chat model after the answer, so nobody waits for it. See [Follow-up suggestions](/docs/using/follow-up-suggestions). |
| **Rerank passages** | Shown once the platform has a [rerank model](/docs/administration/reranking). A rerank model reads the question with each passage found and keeps the best: more precise, and SystemOne judges fewer passages. On by default. |
| **Passages kept after reranking** | The best passages of each search given to SystemOne judging or the model (1–20; default 6). |

The section's summary lists what's on, starting with the reasoning effort and the answer length, and including reranking when the platform has a rerank model.

<Screenshot slot="agent-build-advanced-follow-ups" />

### Try it

The panel beside Build chats with the **draft**, so you can test a change before publishing it. It works like the chat, with two differences: you can open the model's reasoning, and every answer has **Add to evaluations**. It offers [follow-up suggestions](/docs/using/follow-up-suggestions) like the chat, when the draft has them on. Since v0.4.2 its message box stays whole however short the window (the conversation shrinks first), a shadow at the bottom shows when more is below, and **Send** is a secondary button, so **Publish** is the page's one main action.

Since v0.4.1 the reasoning and the answer's steps are shown in the order they happened. Tool steps use the tool's title ("Used Check outage", v0.4.2). With **Let the model decide when to search**, or with tools, the model may think, search or call a tool, then think again: Try it shows the reasoning before the call, the call, then the reasoning after it, each part of the reasoning in its own collapsed **Reasoning** panel (only the last one streams, until the answer starts). With **Search before every answer** the search comes first, as before. Before v0.4.1 every step came first and all the reasoning was merged after them. A citation's source opens in the [source viewer](/docs/using/source-viewer) under the conversation. Test conversations aren't kept in your conversation history, never use or create [saved answers](/docs/using/editors/saved-answers), and don't count towards [Gaps](/docs/using/editors/gaps).

## Appearance

The agent's look and welcome. Like Settings, these aren't versioned: saved changes reach people at once (see [A live agent's profile](#a-live-agents-profile)).

- **Accent colour**: used for the agent's avatar and highlights, always with white text, and checked for contrast in light and dark mode. Leave it empty for the theme's default. A colour that fails the check says so once, on the field.
- **Welcome message**, shown when a chat starts.
- **Starter questions**: suggestions people can pick. They also appear under a refusal, as a hint of what the agent covers.

A live preview shows the result. There's no custom CSS, so every agent stays accessible.

## Settings

**Name**, **Address** and **Description**; **Saved answers**: whether the agent reuses a recent answer to the same first question, for how long (24 hours by default), and **Clear saved answers** ([Saved answers](/docs/using/editors/saved-answers); on by default for public agents); and a danger zone to **Disable**, **Enable** or **Delete** the agent.

These settings aren't part of versions: saved changes reach people at once. A save of only these fields says "Saved", not "Draft saved", and the team's audit log records it as "Changed agent details". Disabling an agent stops all chat with it until you enable it again. Deleting it stops chat for good; people keep read-only access to their own conversations with it.

A platform admin can also disable an agent. It then shows "Disabled by platform" and only a platform admin can enable it again; the team's admins and owners are notified.

### A live agent's profile

The name, address, description, accent colour, welcome message and starter questions reach people as soon as they're saved. So since v0.4.2, while an agent is live for **signed-in users** or the **public**, only the team's admins and owners change them. Editors see the Appearance and Settings fields read-only, with the reason ("This agent is live for … , so only team admins and owners can change what's here: changes reach people at once. You can still change its draft in Build."), and the API refuses them (403 `live_profile_forbidden`). Editors still change the draft in Build and publish to the team, and can still clear saved answers. A team-only agent works as before.

## Evaluations and Analytics

The **Evaluations** tab holds the agent's evaluation sets ([Evaluations](/docs/using/editors/evaluations)). **Analytics** shows its usage and quality ([Agent analytics](/docs/using/editors/agent-analytics)), and under **Gaps** the topics of questions it couldn't answer ([Gaps](/docs/using/editors/gaps)). **Share** is covered in [Sharing an agent](/docs/using/editors/sharing).
