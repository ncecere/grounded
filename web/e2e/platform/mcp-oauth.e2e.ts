import { createHash, randomBytes } from "node:crypto";
import { Api } from "../support/api";
import { createTeam } from "../support/arrange";
import { baseURL } from "../support/env";
import { expect, test } from "../support/fixtures";

/*
 * OAuth sign-in for MCP clients (experimental, docs/mcp.md): a platform
 * setting, so this spec is in the "platform" project (after the parallel
 * specs, one at a time). A registered client sends a person to the consent
 * page; Allow returns a code to the client's local listener; the person's
 * API keys page lists the app and disconnects it.
 */

const callback = "http://127.0.0.1:4567/callback";

test.afterEach(async ({ admin }) => {
  await admin.putRevised("/v1/admin/settings/mcp", { enabled: false, oauthEnabled: false });
});

test("an AI tool connects with OAuth: consent, a code, tokens, and Disconnect on the API keys page", async ({ as, admin, a11y }) => {
  await admin.putRevised("/v1/admin/settings/mcp", { enabled: true, oauthEnabled: true });
  const owner = await Api.signIn("casey");
  const team = await createTeam(admin, owner, { prefix: "oauth" });
  await owner.dispose();
  const reg = await (
    await fetch(`${baseURL}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "E2E Assistant", redirect_uris: ["http://127.0.0.1/callback"], client_uri: "https://assistant.example.com" }),
    })
  ).json();
  const verifier = randomBytes(40).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({
    client_id: reg.client_id, redirect_uri: callback, response_type: "code", code_challenge: challenge,
    code_challenge_method: "S256", resource: `${baseURL}/mcp`, state: "e2e-state",
  });

  const page = await as("casey");
  // The client's local listener.
  await page.route(`${callback}**`, (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><title>Signed in</title><main><h1>You can close this tab</h1></main></html>' }));
  await test.step("the consent page names the app, its host and what it may do", async () => {
    await page.goto(`/oauth/authorize?${q}`);
    await expect(page).toHaveURL(/\/oauth\/consent\?/);
    await expect(page.getByRole("heading", { level: 1, name: /E2E Assistant wants to use .+ as you/ })).toBeVisible();
    await expect(page.getByText("assistant.example.com")).toBeVisible();
    await expect(page.getByText("Unverified").first()).toBeVisible();
    await expect(page.getByText("Search knowledge bases and ask agents you can use, as you")).toBeVisible();
    await a11y(page, "consent");
  });

  let code = "";
  await test.step("Allow sends the browser back with a code, the state and the issuer", async () => {
    await page.getByRole("button", { name: "Allow" }).click();
    await page.waitForURL(`${callback}**`);
    const back = new URL(page.url());
    expect(back.searchParams.get("state")).toBe("e2e-state");
    expect(back.searchParams.get("iss")).toBe(baseURL);
    code = back.searchParams.get("code") ?? "";
    expect(code).toMatch(/^gac_/);
    await a11y(page, "the client's callback");
  });

  await test.step("the code becomes tokens once", async () => {
    const form = { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: callback, client_id: reg.client_id };
    const res = await fetch(`${baseURL}/oauth/token`, { method: "POST", body: new URLSearchParams(form) });
    const tokens = await res.json();
    expect(res.status).toBe(200);
    expect(tokens.access_token).toMatch(/^gat_/);
    const again = await fetch(`${baseURL}/oauth/token`, { method: "POST", body: new URLSearchParams(form) });
    expect(again.status).toBe(400);
  });

  await test.step("the API keys page lists the app and disconnects it", async () => {
    await page.goto(`/teams/${team}/settings?tab=api-keys`);
    const card = page.getByRole("region", { name: "Connected apps" });
    await expect(card.getByRole("table", { name: "Connected apps" }).getByText("E2E Assistant")).toBeVisible();
    await a11y(page, "connected apps");
    await card.getByRole("button", { name: "Disconnect E2E Assistant…" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Disconnect E2E Assistant?" });
    await a11y(page, "disconnect?");
    await confirm.getByRole("button", { name: "Disconnect" }).click();
    await expect(card.getByText("No connected apps.")).toBeVisible();
  });
});
