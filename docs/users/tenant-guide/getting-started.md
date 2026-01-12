# Tenant User Guide - Getting Started

Welcome to Grounded! This guide will help you get started with your tenant workspace.

## What is a Tenant?

A tenant is your organization's workspace in Grounded. Within your tenant, you can:
- Create knowledge bases with your content
- Build AI chat agents
- Deploy chat widgets on your websites
- Analyze usage and performance

## Accessing Your Tenant

### First-Time Login

1. Navigate to your Grounded instance
2. Log in with your credentials:
   - **Email/Password**: Use the login form
   - **SSO**: Click "Sign in with SSO" if configured

### Selecting Your Tenant

If you belong to multiple tenants:

1. Look for the **tenant switcher** in the top-left
2. Click to see available tenants
3. Select the tenant you want to work with

Your current tenant is shown in the header.

## Navigation Overview

The sidebar provides access to all features:

### Workspace Section

| Menu Item | Purpose |
|-----------|---------|
| **Knowledge Bases** | Manage your content sources |
| **Agents** | Configure AI chat agents |
| **Analytics** | View usage and performance |
| **Settings** | Tenant configuration (admins only) |

### Understanding Your Role

Your capabilities depend on your role:

| Role | Can Do |
|------|--------|
| **Viewer** | View KBs, agents, and analytics |
| **Member** | Create and manage KBs and agents |
| **Admin** | + Manage team members and settings |
| **Owner** | + Full control, can delete tenant |

Check your role in the tenant switcher dropdown.

## Quick Start Tutorial

### 1. Create a Knowledge Base

A knowledge base stores your content for the AI to reference.

1. Go to **Knowledge Bases**
2. Click **Create Knowledge Base**
3. Enter a name (e.g., "Product Documentation")
4. Click **Create**

### 2. Add Content

Add sources to your knowledge base:

**Option A: Upload Documents**
1. Open your knowledge base
2. Click **Upload**
3. Select files (PDF, Word, Excel, etc.)
4. Wait for processing to complete

**Option B: Add Web Source**
1. Open your knowledge base
2. Click **Add Source**
3. Enter a URL
4. Choose crawl mode:
   - **Single Page**: Just this URL
   - **Sitemap**: All pages from sitemap
   - **Domain**: Crawl entire website
5. Click **Create**
6. Click **Start Crawl**

### 3. Create an Agent

An agent is the AI that answers questions using your knowledge.

1. Go to **Agents**
2. Click **Create Agent**
3. Configure:
   - **Name**: Give it a name
   - **Knowledge Bases**: Select your KB
   - **System Prompt**: (optional) Customize behavior
4. Click **Create**

### 4. Test Your Agent

1. Open your agent
2. Click **Test Chat**
3. Ask questions about your content
4. Verify responses include citations

### 5. Deploy

Once satisfied with your agent:

1. Go to agent settings
2. Choose deployment method:
   - **Widget**: Embed on your website
   - **API**: Integrate programmatically
   - **Hosted**: Share a direct link

See the [Integration Guide](../integration/widget.md) for detailed deployment instructions.

## Understanding the Interface

### Knowledge Base View

When you open a knowledge base, you see:

| Tab | Shows |
|-----|-------|
| **Overview** | Statistics and status |
| **Sources** | Web and upload sources |
| **Uploads** | Uploaded documents |

### Agent View

When you open an agent, you see:

| Tab | Shows |
|-----|-------|
| **Overview** | Basic configuration |
| **Knowledge Bases** | Attached KBs |
| **Retrieval** | RAG settings |
| **Widget** | Widget configuration |

To create chat endpoints (API, widget, hosted), click the **Chat** button on the agent card.

### Analytics View

The analytics dashboard shows:

- Total queries
- Average response time
- Daily usage trends
- Agent-specific metrics

## Common Tasks

### Updating Content

To refresh web content:

1. Go to **Knowledge Bases** > Select KB
2. Find the source
3. Click **Recrawl**

To replace a document:

1. Delete the old upload
2. Upload the new version

### Changing Agent Behavior

To modify how your agent responds:

1. Go to **Agents** > Select agent
2. Update the **System Prompt**
3. Adjust **Retrieval Settings**:
   - **Top K**: More sources = more context
   - **Max Citations**: Citations shown to users
4. Test changes with **Test Chat**

### Adding Team Members

(Admin/Owner only)

1. Go to **Settings** > **Team**
2. Click **Add Member**
3. Enter email and select role
4. Click **Add**

## Best Practices

### Content Organization

- **Group related content** in the same KB
- **Use descriptive names** for easy identification
- **Keep sources focused** - smaller, focused KBs often perform better

### Agent Configuration

- **Clear system prompts** help consistent responses
- **Test thoroughly** before deploying
- **Monitor analytics** for issues

### Performance

- **Process content before deploying** - ensure all sources are indexed
- **Start with fewer sources** and add as needed
- **Review citations** to verify quality

## Troubleshooting

### "No results found"

- Ensure sources are fully processed
- Check that content is relevant to the query
- Try rephrasing the question

### Slow responses

- Reduce Top K in retrieval settings
- Check source processing status
- Contact admin if persistent

### Missing citations

- Verify content covers the topic
- Check citation settings are enabled
- Ensure sources completed indexing

## Next Steps

- **[Knowledge Bases](./knowledge-bases.md)** - Deep dive into content management
- **[Agents](./agents.md)** - Advanced agent configuration
- **[Widget Integration](../integration/widget.md)** - Deploy on your website

## Getting Help

- Review this documentation
- Contact your tenant admin
- Check system status in Analytics

---

Next: [Knowledge Bases](./knowledge-bases.md)
