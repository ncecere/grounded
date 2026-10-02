# The source viewer

A citation opens the passage it points to, highlighted in its document, beside the answer (v0.4.0, roadmap B10 and A13; design in [`v0.4.0.md`](v0.4.0.md) §5). It is the quickest way to check that an answer says what its sources say.

## Opening a source

- **A citation chip's card:** hover over, click or press Enter on a `[n]` chip, then choose **Show source n**.
- **A source card:** the cards under an answer ("Used 3 sources") are buttons that open the viewer. A web page's card also has a separate link that opens the page itself.

The viewer opens:

- **Beside the conversation** on the chat page and the public page, as a split view you can resize (drag the handle, or focus it and use the arrow keys, Home and End).
- **Under the conversation** where the chat is narrow, such as Try it beside an agent's Build sections.
- **As a full-screen sheet** on a phone and inside the widget, with **Close the source** (an arrow back) at the start of its header. Focus goes to its title, and a long sheet can be scrolled with the keyboard.

It is never an overlay drawer: the conversation stays where it was. **Escape** or **Close the source** closes it, and focus goes back to what opened it (or to the **Show source** button of the source's card under the answer when that was a chip's card). The cited passage scrolls into view when the viewer opens.

## What it shows

- **The document's title**, "Source 2 of 3", and the passage's heading path and pages.
- **The answer's other sources** as numbered buttons, so each is one click away.
- **The claims citing this source** (with SystemOne citation checks, [`systemone.md`](systemone.md) §3), each with this source's verdict on it: Supported, Not supported, Contradicted or Not checked.
- **The cited passage, highlighted** (a coloured bar and background, and "Cited passage" in words), among its neighbours: about a page of the document. Text that the chunker repeats from one passage at the start of the next is left out, so it reads like the document.
- **Open the page** for web pages, when the agent links its sources (citation mode "snippet and link"): the live page, with a [text fragment](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment/Text_fragments) built from the passage's first and last words, so browsers that support them scroll to and highlight the passage.
- **Open full document** for the team's editors, admins and owners: the whole document, from a little before the cited passage, with **Show earlier passages** and **Show later passages**.

### When the passage is gone

Documents change after an answer is written. The viewer says so instead of showing the wrong text:

- **"This document was deleted after the answer was written."**
- **"This passage is no longer in the document. The document changed after the answer was written."** (for example a re-fetched web page whose text changed, or a document re-processed for a new embedding profile with different passages).

Both show what the answer quoted. A passage stored again with the same text (a re-fetch that found the page unchanged, an answer from before v0.4.0 without a passage ID) is found again by its text.

## Source cards: claims per source

With SystemOne citation checks, a source card under the answer breaks down how that source fared with each claim citing it, in the verdict colours: **"Supports 3 claims · 1 not supported"**, "1 claim contradicted", "· 1 not checked". Before v0.4.0 a card said "Supports 2 of 3 claims that cite it". The words carry the meaning; the colour only repeats it. Answers checked before v0.2.1 (without claims) still show the source's own verdict.

## Who can open what

| Who | What |
|---|---|
| The person who asked (signed in, or an API key acting as them with the `query` scope) | The passages their answers cited, in context. Nobody else's conversations: team admins and platform admins get 404 here (ADR-0010); break-glass covers transcripts, not this. |
| An anonymous visitor of a public agent (public page or widget) | The passages cited in their own session's conversations only. |
| The source's team editors, admins and owners (who see the document in Data sources anyway) | Also the whole document. In Try it and the widget preview (nothing stored), passages open through the team's documents. |
| Team members | Never a whole document: only passages their answers cited. |

Only cited passages are served, by their number in the answer, so nobody can page through a knowledge base by asking questions.

## API

- `GET /v1/messages/{messageId}/sources/{n}`: source `n` of an answer in one of the caller's conversations, in context (`CitedPassage`: status, title, heading path, link, passages with the cited one marked, the claims citing it, and `documentTeam` when the caller may open the whole document).
- `GET /v1/public/agents/{agentId}/messages/{messageId}/sources/{n}`: the same for an anonymous session (the session cookie).
- `GET /v1/teams/{team}/sources/{sourceId}/documents/{documentId}/text`: the whole document for the team's editors, admins and owners: `?from=&limit=` (up to 200 passages), or `?around={passageId}` for a passage in context.
- Citations carry `chunkId`, the cited passage (absent for answers from before v0.4.0, which are found by their text).
