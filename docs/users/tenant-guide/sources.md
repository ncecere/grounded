# Data Sources

Data sources define where your knowledge base content comes from. Grounded supports web crawling and file uploads.

## Overview

Sources are the origin of your knowledge base content. Each source can be:
- **Web Source**: Content crawled from websites
- **Upload**: Documents uploaded directly

## Web Sources

Web sources automatically fetch and index content from URLs.

### Creating a Web Source

1. Open your knowledge base
2. Go to **Sources** tab
3. Click **Add Web Source**
4. Configure the source settings

### Source Configuration

| Field | Description |
|-------|-------------|
| **Name** | Identifier for this source |
| **URL** | Starting point URL |
| **Crawl Mode** | How pages are discovered |
| **Schedule** | When to re-crawl |

### Crawl Modes

#### Single Page

Fetches only the specified URL.

**Best for:**
- Individual blog posts
- Specific documentation pages
- Landing pages

**Example:**
```
URL: https://docs.example.com/getting-started
Mode: Single Page
Result: Only that one page is indexed
```

#### Sitemap

Follows the website's sitemap.xml to discover pages.

**Best for:**
- Structured websites
- Documentation sites
- Blogs with sitemaps

**Example:**
```
URL: https://docs.example.com
Mode: Sitemap
Result: All pages listed in sitemap.xml
```

#### Domain Crawl

Discovers pages by following links from the starting URL.

**Best for:**
- Full website indexing
- Sites without sitemaps
- Comprehensive coverage

**Configuration:**
| Setting | Description |
|---------|-------------|
| **Max Depth** | How many link levels to follow |
| **Include Subdomains** | Crawl subdomains too |
| **Include Patterns** | URL patterns to include |
| **Exclude Patterns** | URL patterns to skip |

**Example:**
```
URL: https://example.com/docs
Mode: Domain
Max Depth: 3
Include: /docs/*
Exclude: /docs/archive/*
```

### URL Patterns

Control which pages are crawled using patterns.

#### Include Patterns

Only crawl URLs matching these patterns:

```
/docs/*           # All docs pages
/blog/2024/*      # 2024 blog posts
/api/v2/*         # API v2 documentation
```

#### Exclude Patterns

Skip URLs matching these patterns:

```
/admin/*          # Admin pages
/login            # Login page
*.pdf             # PDF files (use uploads instead)
/tag/*            # Tag archive pages
```

### Scheduling

Configure automatic re-crawling to keep content fresh.

| Schedule | Description |
|----------|-------------|
| **Manual** | Only crawl when triggered |
| **Daily** | Re-crawl every 24 hours |
| **Weekly** | Re-crawl every 7 days |
| **Monthly** | Re-crawl every 30 days |

### Running a Crawl

#### Manual Trigger

1. Open the source
2. Click **Start Crawl**
3. Monitor progress in **Runs** tab

#### Viewing Crawl Status

Each crawl run shows:
- **Status**: Running, Completed, Failed
- **Pages Found**: Total discovered URLs
- **Pages Processed**: Successfully indexed
- **Errors**: Failed pages with reasons
- **Duration**: Time taken

### Crawl Results

After a crawl completes:

**Pages Tab:**
- List of all crawled URLs
- Status of each page
- Last crawl timestamp
- Content preview

**Errors Tab:**
- Failed URLs
- Error messages
- Suggested fixes

### Common Crawl Issues

#### "Connection Refused"

**Causes:**
- URL is incorrect
- Site is blocking crawlers
- Firewall rules

**Solutions:**
- Verify URL is accessible in browser
- Check if site has anti-bot protection
- Contact site administrator

#### "No Content Found"

**Causes:**
- JavaScript-rendered content
- Page requires authentication
- Content behind paywall

**Solutions:**
- Check if content loads without JavaScript
- Verify page is publicly accessible
- Consider using uploads instead

#### "Rate Limited"

**Causes:**
- Too many requests too fast
- Site has strict rate limits

**Solutions:**
- Crawls are automatically throttled
- Wait and retry
- Consider sitemap mode for large sites

#### "Robots.txt Blocked"

**Causes:**
- Site disallows crawling

**Solutions:**
- Check robots.txt rules
- Contact site owner for permission
- Use uploads for blocked content

## File Uploads

Upload documents directly to your knowledge base.

### Uploading Files

1. Open your knowledge base
2. Go to **Uploads** tab
3. Click **Upload** or drag files
4. Wait for processing

### Supported Formats

| Format | Extensions | Notes |
|--------|------------|-------|
| **PDF** | .pdf | Text extracted from all pages |
| **Word** | .docx, .doc | Full content including tables |
| **Excel** | .xlsx, .xls | All sheets processed |
| **PowerPoint** | .pptx, .ppt | Slide content extracted |
| **Text** | .txt, .md | Direct text processing |
| **HTML** | .html, .htm | Content extraction |
| **CSV** | .csv | Structured data |
| **JSON** | .json | Structured data |

### Upload Processing

Files go through several stages:

1. **Upload**: File transferred to server
2. **Extraction**: Text extracted from format
3. **Chunking**: Text split into segments
4. **Embedding**: Vectors generated
5. **Indexing**: Stored for search

### Upload Status

| Status | Description |
|--------|-------------|
| **Uploading** | File being transferred |
| **Processing** | Text being extracted |
| **Embedding** | Vectors being generated |
| **Complete** | Ready for search |
| **Failed** | Error during processing |

### Viewing Upload Content

1. Click on an upload
2. View extracted text
3. See generated chunks
4. Check metadata

### Updating Uploads

To update a document:

1. Delete the existing upload
2. Upload the new version

Grounded doesn't auto-detect file changes.

### Upload Limits

Default limits (configurable by admin):

| Limit | Default |
|-------|---------|
| **Max file size** | 50 MB |
| **Max files per upload** | 10 |
| **Supported formats** | See table above |

### Common Upload Issues

#### "Unsupported Format"

**Solutions:**
- Convert to supported format
- Use PDF for complex documents
- Export from source application

#### "File Too Large"

**Solutions:**
- Split into smaller files
- Compress if possible
- Contact admin for limit increase

#### "Processing Failed"

**Causes:**
- Encrypted/password-protected file
- Corrupted file
- Unsupported encoding

**Solutions:**
- Remove password protection
- Re-export from source
- Try different format

## Source Management

### Editing Sources

1. Open the source
2. Click **Edit**
3. Update settings
4. Save changes

For web sources, changes apply to next crawl.

### Deleting Sources

1. Open the source
2. Click **Delete**
3. Confirm deletion

**Warning**: Deleting a source removes all its content from the knowledge base.

### Refreshing Content

**Web Sources:**
- Trigger manual crawl
- Or wait for scheduled crawl

**Uploads:**
- Delete and re-upload

### Source Statistics

Each source shows:
- Total chunks indexed
- Last update time
- Processing status
- Error count

## Best Practices

### Web Sources

1. **Start small**: Test with single page before domain crawl
2. **Use patterns**: Be specific about what to include/exclude
3. **Schedule appropriately**: Match update frequency to content changes
4. **Monitor errors**: Address crawl failures promptly

### Uploads

1. **Use searchable PDFs**: Not scanned images
2. **Keep files focused**: One topic per document
3. **Update regularly**: Remove outdated content
4. **Use descriptive names**: Helps with organization

### Content Quality

1. **Authoritative sources**: Use official documentation
2. **Current content**: Remove outdated information
3. **Avoid duplicates**: Don't index same content twice
4. **Test retrieval**: Verify content is found in searches

## API Reference

### List Sources

```bash
GET /api/v1/knowledge-bases/{kbId}/sources
X-Tenant-ID: <tenant-id>
Authorization: Bearer <token>
```

### Create Web Source

```bash
POST /api/v1/knowledge-bases/{kbId}/sources
X-Tenant-ID: <tenant-id>
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Documentation",
  "url": "https://docs.example.com",
  "crawlMode": "sitemap",
  "schedule": "weekly"
}
```

### Trigger Crawl

```bash
POST /api/v1/sources/{sourceId}/crawl
X-Tenant-ID: <tenant-id>
Authorization: Bearer <token>
```

### Upload File

```bash
POST /api/v1/knowledge-bases/{kbId}/uploads
X-Tenant-ID: <tenant-id>
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary>
```

### Delete Source

```bash
DELETE /api/v1/sources/{sourceId}
X-Tenant-ID: <tenant-id>
Authorization: Bearer <token>
```

---

Next: [Agents](./agents.md)
