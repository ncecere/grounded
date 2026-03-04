# Glossary

Key terms used throughout Grounded, explained in plain language.

## A

**A/B Test**
A comparison of two versions of something (usually system prompts) to see which performs better. Grounded runs the same test suite with each version and compares pass rates.

**Advanced RAG**
A multi-step retrieval mode where the AI rewrites your question, breaks it into sub-queries, searches multiple times, and merges results before generating an answer. Shows reasoning steps in the chat. See also: *Simple RAG*.

**Agent**
An AI assistant configured with a personality (system prompt), one or more knowledge bases, and an LLM model. Each agent is a separate chat experience you can offer to users.

**Audit Log**
A record of who did what and when in the system. Used for security, compliance, and debugging. Visible to System Admins.

## C

**Candidate K**
The number of chunks initially retrieved from the vector database during a search. These are then narrowed down to the *Top K* best results. Higher values cast a wider net but are slower.

**Chat Endpoint**
A URL that allows external systems to send chat messages to an agent. Can be an API endpoint (for code) or a hosted page (for browsers).

**Chunk**
A small piece of text extracted from a source document. Documents are broken into chunks (typically ~800 tokens) so the AI can find and cite specific sections rather than entire pages.

**Citation**
A numbered reference in an agent's response (e.g., `[1]`, `[2]`) that links to a specific source. Allows users to verify the information.

## D

**Domain Crawl**
A scrape mode that follows links to discover and ingest an entire website, starting from a seed URL. Respects include/exclude URL patterns.

## E

**Embedding**
A numerical representation of text (a list of numbers) that captures its meaning. Used to find content that is semantically similar to a question, even if the exact words are different.

**Embedding Model**
An AI model specifically designed to convert text into embeddings. Different from the chat model — it doesn't generate responses, only numerical representations.

## H

**Hosted Chat Page**
A full-page chat interface accessible via a shareable URL. No code changes needed — just share the link.

**Hybrid Search**
The combination of two search methods: vector search (meaning-based) and full-text search (keyword-based). Results are merged using Reciprocal Rank Fusion for better accuracy than either method alone.

## I

**Ingestion**
The process of converting raw content (web pages, documents) into searchable chunks with embeddings. Involves: discovery → fetching → chunking → embedding → indexing.

## K

**Knowledge Base (KB)**
A collection of information that an agent can search when answering questions. Contains sources (web pages, uploaded files) that have been ingested into searchable chunks.

## L

**LLM (Large Language Model)**
The AI model that generates text responses. Examples: GPT-4, Claude, Gemini. In Grounded, each agent is configured to use a specific LLM.

**LLM Judge**
A test check type where an AI model evaluates whether the agent's response is acceptable, rather than using simple text matching.

## M

**MCP (Model Context Protocol)**
A standard for connecting AI models to external tools and data sources. Grounded supports MCP connections for agentic capabilities.

**Multi-Tenant**
A system design where multiple organizations (tenants) share the same infrastructure but their data is completely isolated from each other.

## P

**Pass Rate**
The percentage of test cases that passed in a test suite run. For example, if 8 out of 10 cases pass, the pass rate is 80%.

**Prompt Analysis**
An AI-powered feature that analyzes test failures, identifies patterns, and suggests improvements to the system prompt.

## R

**RAG (Retrieval-Augmented Generation)**
The technique of searching a knowledge base for relevant information and including it in the AI's prompt, so responses are grounded in your actual content rather than the model's training data.

**Regression**
When test pass rates drop compared to a previous run. Grounded can alert you when this happens.

**Retrieval Config**
Settings that control how an agent searches its knowledge bases: how many results to retrieve, similarity thresholds, and other tuning parameters.

## S

**Semantic Similarity**
A measure (0 to 1) of how similar two pieces of text are in meaning. 1.0 = identical meaning, 0.0 = completely unrelated. Used in test evaluations to compare actual vs expected responses.

**Simple RAG**
The default retrieval mode. Searches knowledge bases once, retrieves relevant chunks, and generates a single response. Faster than Advanced RAG but less thorough for complex questions. See also: *Advanced RAG*.

**Similarity Threshold**
The minimum similarity score a chunk must have to be considered relevant. Lower values (0.3–0.5) return more results including loosely related content. Higher values (0.7–0.9) return only very relevant results.

**Source**
A content origin attached to a knowledge base — either a web URL (scraped) or an uploaded file. Sources are ingested into chunks for searching.

**Source Run**
One execution of ingestion for a source — discovering pages, fetching content, chunking, embedding, and indexing.

**System Prompt**
Instructions given to the AI model that define how the agent behaves. Controls tone, format, what to include/exclude, and how to cite sources. The user doesn't see this text.

## T

**Tenant**
An organization within Grounded. Each tenant has its own knowledge bases, agents, members, and settings. Data is isolated between tenants.

**Test Suite**
A collection of test cases that evaluate an agent's response quality. Can be run manually or on a schedule.

**Token (Authentication)**
A secret string used to authenticate API or widget access. Different from LLM tokens.

**Token (LLM)**
A unit of text processed by an AI model. Roughly 4 characters or ¾ of a word in English. Used for measuring usage and billing.

**Top K**
The number of highest-ranked chunks included in the AI's prompt when generating a response. Higher values give the AI more context but increase cost and latency.

## V

**Vector Search**
A search method that finds content based on meaning rather than exact keywords. Converts the question to an embedding and finds chunks with similar embeddings.

## W

**Widget**
An embeddable chat interface that can be added to any website. Appears as a floating button that opens a chat panel. Rendered in a Shadow DOM for CSS isolation.

**Widget Token**
A secret string that identifies which agent a widget connects to. Generated in the agent's Widget configuration tab.
