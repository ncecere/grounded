import http from "node:http";
import type { AddressInfo } from "node:net";
import { Api, type Schemas } from "./support/api";
import { createTeam, handbook, publishedAgent } from "./support/arrange";
import { baseURL } from "./support/env";
import { type Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

/*
 * Public agents (the seed turns public access on and gives the public
 * audience a moderation policy): the public page for signed-out visitors,
 * and the widget on another site's page. The "other sites" are tiny pages
 * served from this spec on their own loopback ports (origins).
 */

type Site = { origin: string; url: (agentId: string, key: string) => string; close: () => Promise<void> };

/** Serves a page embedding the widget, for the agent and key in its query string. */
async function hostSite(): Promise<Site> {
  const server = http.createServer((req, res) => {
    const q = new URL(req.url ?? "/", "http://host").searchParams;
    const attr = (v: string | null) => (v ?? "").replace(/[^A-Za-z0-9_-]/g, "");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Transportation office</title></head>
<body><main><h1>Transportation office</h1><p>Questions? Use the chat button in the corner.</p></main>
<script src="${baseURL}/widget.js" data-agent="${attr(q.get("agent"))}" data-key="${attr(q.get("key"))}" async></script>
</body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    url: (agentId, key) => `${origin}/?agent=${agentId}&key=${key}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function publicAgent(admin: Api, name: string, docs?: { name: string; body: string }[]) {
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "public" });
  const { agent } = await publishedAgent(owner, team, { name, audience: "public", docs });
  return { owner, team, agent };
}

/** The next chat stream's body (SSE), once it ends. */
const chatStream = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/chat") && r.request().method() === "POST").then((r) => r.text());

test("the public page: a signed-out visitor chats with a public agent", async ({ page, admin, a11y }) => {
  const { owner, team } = await publicAgent(admin, "Public parking");
  await owner.dispose();

  await page.goto(`/a/${team}/public-parking`);
  const composer = page.getByRole("textbox", { name: "Message Public parking" });
  await expect(composer).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
  await a11y(page, "public agent page");

  await composer.fill("How much is a student parking permit?");
  const stream = chatStream(page);
  await composer.press("Enter");
  const answer = page.getByRole("article", { name: "Public parking said" });
  await expect(answer).toContainText(handbook.answer);
  // Public answers stream in checked paragraphs (the seed's policy, the public default): no thinking.
  const body = await stream;
  expect(body).toContain('"mode":"stream_checked"');
  expect(body).toContain("event: text_delta");
  expect(body).not.toContain("event: thinking_delta");
  // The sources start collapsed.
  const sources = answer.getByRole("button", { name: "Used 1 source" });
  await expect(sources).toHaveAttribute("aria-expanded", "false");
  await sources.click();
  await expect(answer.getByRole("list", { name: "Sources for this answer" }).getByRole("listitem")).toHaveCount(1);
  await a11y(page, "public answer");
  // The source card opens the cited passage beside the conversation, through the visitor's own session.
  await answer.getByRole("button", { name: /^Show source 1: / }).click();
  const viewer = page.getByTestId("source-viewer");
  await expect(viewer.getByTestId("cited-passage")).toContainText(handbook.answer);
  await expect(viewer.getByRole("button", { name: "Open full document" })).toHaveCount(0);
  await a11y(page, "public source viewer");
  await viewer.getByRole("button", { name: "Close the source" }).click();
  await expect(viewer).toBeHidden();
});

test("the public page: a failing paragraph replaces the whole answer with the notice", async ({ page, admin, a11y }) => {
  // The fake model answers "The sources say:" and, in a paragraph of its own, the document's first line, which fails.
  const fines = { name: "fines.md", body: "FAKE-LIST Parking fines are paid at the UNSAFE-VIOLENCE window of the transportation office.\n" };
  const { owner, team } = await publicAgent(admin, "Public fines", [fines]);
  await owner.dispose();

  await page.goto(`/a/${team}/public-fines`);
  const composer = page.getByRole("textbox", { name: "Message Public fines" });
  await composer.fill("Where are parking fines paid?");
  const stream = chatStream(page);
  await composer.press("Enter");
  const answer = page.getByRole("article", { name: "Public fines said" });
  await expect(answer).toContainText("Answer removed");
  await expect(answer).toContainText("This message can't be answered because it may break the usage policy.");
  await expect(answer).not.toContainText("The sources say");
  await expect(answer).not.toContainText("Parking fines are paid");
  // The first paragraph was shown, then retracted; the failing one never was.
  const body = await stream;
  expect(body).toContain('"action":"retracted"');
  expect(body.indexOf("event: text_delta")).toBeLessThan(body.indexOf("event: moderation"));
  const shown = body.split("\n\n").filter((e) => e.startsWith("event: text_delta")).join("\n");
  expect(shown).toContain("The sources say");
  expect(shown).not.toContain("UNSAFE-VIOLENCE");
  await a11y(page, "public answer replaced by the notice");
});

test("the widget on an allowed origin, and nothing on another", async ({ page, admin, a11y }) => {
  const { owner, team, agent } = await publicAgent(admin, "Widget parking");
  const [allowed, other] = await Promise.all([hostSite(), hostSite()]);
  try {
    const { key } = await owner.post<Schemas["PublishableKeyCreated"]>(`/v1/teams/${team}/agents/${agent.id}/publishable-keys`, {
      name: "Transportation site",
      allowedOrigins: [allowed.origin],
    });
    await owner.dispose();
    // The widget lives in a closed shadow root. Open it for this test, so the
    // locators and axe reach the launcher and panel.
    await page.addInitScript(() => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (init: ShadowRootInit) {
        return attach.call(this, { ...init, mode: "open" });
      };
    });

    await test.step("allowed origin: the launcher opens the chat panel", async () => {
      await page.goto(allowed.url(agent.id, key));
      const launcher = page.getByRole("button", { name: "Chat with Widget parking" });
      await expect(launcher).toBeVisible();
      await a11y(page, "host page with the widget");
      await launcher.click();
      await expect(launcher).toHaveAttribute("aria-expanded", "true");
      const panel = page.getByRole("dialog", { name: "Chat with Widget parking" });
      await expect(panel).toBeVisible();

      const widget = page.frameLocator('iframe[title="Chat with Widget parking"]');
      const composer = widget.getByRole("textbox", { name: "Message Widget parking" });
      await expect(composer).toBeEnabled();
      await a11y(page, "widget panel open");
      await composer.fill("How much is a student parking permit?");
      const stream = chatStream(page);
      await composer.press("Enter");
      await expect(widget.getByRole("article", { name: "Widget parking said" })).toContainText(handbook.answer);
      expect(await stream).toContain('"mode":"stream_checked"');
      await a11y(page, "widget answer");

      await panel.getByRole("button", { name: "Close chat" }).click();
      await expect(launcher).toHaveAttribute("aria-expanded", "false");
      await expect(launcher).toBeFocused();
    });

    await test.step("another origin: no launcher, a console warning for the site owner", async () => {
      const warning = page.waitForEvent("console", (m) => m.type() === "warning" && m.text().includes(`not shown on ${other.origin}`));
      await page.goto(other.url(agent.id, key));
      await warning;
      await expect(page.getByRole("heading", { name: "Transportation office" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Chat with Widget parking" })).toHaveCount(0);
      await a11y(page, "host page on another origin");
    });

    // The server refuses the key there too, whatever the page does.
    const res = await page.request.post(`${baseURL}/v1/public/sessions`, {
      headers: { Origin: other.origin },
      data: { agentId: agent.id, key, embedOrigin: other.origin },
    });
    expect(res.status()).toBe(403);
  } finally {
    await Promise.all([allowed.close(), other.close()]);
  }
});
