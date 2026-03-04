# Troubleshooting

Common problems and solutions for Grounded users.

## Agent Not Finding Answers

**Symptom:** The agent says "I don't have information about that" when you know the content exists.

| Check | How to Fix |
|-------|-----------|
| **Knowledge base has no sources** | Go to the KB → add sources (URLs or file uploads) |
| **Sources haven't been ingested** | Check source status — wait for "Completed" before chatting |
| **Agent isn't attached to the KB** | Go to agent **Configure** → **Knowledge Bases** tab → attach the KB |
| **Question wording is too different from content** | Try rephrasing with terms that appear in your documents |
| **Similarity threshold too high** | In agent **Configure** → **Retrieval** tab → lower the threshold (try 0.4–0.5) |
| **Content is in a format that wasn't extracted** | Check supported formats: PDF, DOCX, XLSX, CSV, TXT, HTML, PPTX, Markdown, EPUB, RTF |

## Poor Quality Responses

**Symptom:** The agent finds sources but gives incomplete or confusing answers.

| Check | How to Fix |
|-------|-----------|
| **System prompt is too generic** | Add specific instructions: tone, format, audience, what to include |
| **Too few sources retrieved** | Increase `topK` in retrieval settings (default: 8) |
| **Too many irrelevant sources** | Increase similarity threshold or reduce `candidateK` |
| **Content is too broad** | Create focused KBs (e.g., separate "Product Docs" from "Company Policies") |
| **Agent is using wrong model** | Check the LLM model in agent configuration — try a more capable model |

## Source Ingestion Failures

**Symptom:** A source shows "Failed" or stays stuck in "Processing."

| Scenario | Solution |
|----------|----------|
| **Web scrape failed** | Check if the site blocks bots — try enabling JS rendering |
| **URL returns 403/404** | Verify the URL is accessible from your server's network |
| **File upload failed** | Check file size (limits vary by type) and format |
| **Stuck in "Scraping" stage** | May be a large site — check progress in source detail view. Contact admin if stuck >1 hour |
| **Stuck in "Processing"** | Worker may have restarted — wait 5 minutes for recovery, then re-trigger the run |
| **"Rate limited" errors** | Your tenant may have hit the monthly scrape quota — check Settings → Quotas |

### Scrape Mode Guide

| Scrape Mode | Best For | Pitfall |
|-------------|----------|---------|
| **Single Page** | One specific URL | Won't follow links |
| **URL List** | Known set of pages | Must list each URL |
| **Sitemap** | Sites with sitemap.xml | Won't find pages not in sitemap |
| **Domain Crawl** | Entire websites | May discover too many pages — set include/exclude patterns |

## Widget Not Showing

**Symptom:** The widget doesn't appear on your website.

| Check | How to Fix |
|-------|-----------|
| **Script not loading** | Open browser DevTools → Network tab → check if `widget.js` loads (200 status) |
| **Wrong token** | Verify the token matches one in agent Configure → Widget tab |
| **Token revoked** | Check if the token was revoked — generate a new one |
| **Domain not allowed** | If you set Allowed Domains, make sure your site is listed |
| **CSP blocking** | Your site's Content Security Policy may block the script — add the Grounded domain to `script-src` and `connect-src` |
| **CORS error** | Check browser console for CORS errors — verify your domain is in the server's CORS configuration |

## Test Suite Issues

**Symptom:** Tests fail unexpectedly or don't run.

| Issue | Solution |
|-------|----------|
| **All tests show "Error"** | Check if the agent's LLM model is configured and working |
| **Semantic similarity always fails** | Verify the KB has an embedding model configured |
| **LLM Judge always fails** | Check that the suite's "LLM Judge Model" is set in Evaluation settings |
| **Run stays in "Running" forever** | The test lock may be stale — wait 45 minutes for auto-recovery |
| **Scheduled run didn't happen** | Verify the suite is enabled and schedule is set in the Schedule tab |
| **Pass rate dropped suddenly** | Check if the KB content changed, the model was updated, or the system prompt was modified |

## Login & Access Issues

| Issue | Solution |
|-------|----------|
| **Can't log in** | Verify email and password. Check if your account is disabled (contact admin) |
| **"Unauthorized" on API calls** | Your session may have expired — refresh the page to re-authenticate |
| **Can't see certain features** | Your role may not have permission — check with your tenant owner |
| **Can't access a tenant** | You may not be a member — ask the tenant owner to add you |

### Role Permissions Quick Reference

| Action | Viewer | Editor | Admin | Owner |
|--------|:------:|:------:|:-----:|:-----:|
| View KBs, agents, chat | ✅ | ✅ | ✅ | ✅ |
| Create/edit sources | ❌ | ✅ | ✅ | ✅ |
| Create/edit agents | ❌ | ✅ | ✅ | ✅ |
| Manage team members | ❌ | ❌ | ✅ | ✅ |
| Manage API keys/tokens | ❌ | ❌ | ✅ | ✅ |
| Delete KBs/agents | ❌ | ❌ | ❌ | ✅ |
| Change tenant settings | ❌ | ❌ | ❌ | ✅ |

## Performance Issues

| Symptom | Possible Cause | Fix |
|---------|---------------|-----|
| **Slow chat responses** | Large knowledge base | Reduce `candidateK` or switch to Simple RAG |
| **Chat timeout** | LLM provider latency | Try a faster model; check provider status |
| **Slow ingestion** | Large files or many pages | Normal for large sites; check worker concurrency in admin settings |
| **UI is slow** | Many items in lists | This is expected with thousands of items; use filters |

## Getting Help

If none of the above solutions work:

1. **Check the Audit Logs** — Admin → Audit Logs → filter by time and resource to see what happened
2. **Check Analytics** — Look at error rates and response times for patterns
3. **Check source run details** — Click into a source → view the latest run → check per-page statuses
4. **Contact your System Admin** — They can check server logs, worker status, and system health
