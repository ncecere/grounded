import { Api, type Schemas } from "./support/api";
import { createTeam } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * Webhooks (v0.6.0, F3), across people: a platform admin turns them on in Settings → Features and approves *.example.com in Admin → Webhooks;
 * a team editor and a member see no Webhooks tab; the team's owner makes a webhook to hooks.example.com for agent.published, sees its secret
 * once, sends a test event (the host does not resolve here, so the delivery is not delivered), changes the description, rotates the secret
 * and deletes the webhook. The switch is the platform's and no other spec depends on it, so it is left on.
 */
test("webhooks: turn on, approve a destination, make one, test it, change it, rotate its secret, delete it", async ({ as, admin, a11y }) => {
  test.setTimeout(180_000);
  const address = "https://hooks.example.com/grounded";
  const ownerApi = await Api.signIn("alex");
  const team = await createTeam(admin, ownerApi, { prefix: "hooks", members: { blair: "editor", casey: "member" } });
  await ownerApi.dispose();
  // A retry starts clean: webhooks off, and the destination not yet approved.
  await admin.putRevised("/v1/admin/settings/webhooks", { enabled: false });
  for (const d of await admin.get<Schemas["WebhookDestination"][]>("/v1/webhook-destinations")) {
    if (d.pattern === "*.example.com") await admin.del(`/v1/admin/webhook-destinations/${d.id}`);
  }

  const platform = await as("admin");
  await test.step("a platform admin turns webhooks on", async () => {
    await platform.goto("/admin/settings");
    const sw = platform.getByRole("switch", { name: "Allow webhooks" });
    await expect(sw).not.toBeChecked();
    await a11y(platform, "settings: webhooks off");
    await sw.click();
    await expect(sw).toBeChecked();
    await a11y(platform, "settings: webhooks on");
  });

  await test.step("and approves a destination", async () => {
    await platform.goto("/admin/webhooks");
    await expect(platform.getByRole("heading", { level: 1, name: "Webhooks" })).toBeVisible();
    await expect(platform.getByText("Webhooks are turned off")).toHaveCount(0);
    await a11y(platform, "admin webhooks: no destination yet");
    await platform.getByRole("textbox", { name: /Host pattern/ }).fill("*.example.com");
    await platform.getByRole("textbox", { name: /Note/ }).fill("E2E receiver");
    await platform.getByRole("button", { name: "Approve destination" }).click();
    const row = platform.getByRole("table", { name: "Approved destinations" }).getByRole("row", { name: /\*\.example\.com/ });
    await expect(row).toContainText("E2E receiver");
    await expect(platform.getByRole("button", { name: "New webhook" })).toBeVisible();
    await a11y(platform, "admin webhooks: destination approved");
  });

  await test.step("a team editor and a member have no Webhooks tab", async () => {
    for (const who of ["blair", "casey"] as const) {
      const page = await as(who);
      await page.goto(`/teams/${team}/settings?tab=webhooks`);
      await expect(page.getByRole("tab", { name: "Members" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Webhooks" })).toHaveCount(0);
      await a11y(page, `team settings as ${who}`);
    }
  });

  const owner = await as("alex");
  const row = () => owner.getByRole("table", { name: "Team webhooks" }).getByRole("row", { name: new RegExp(address) });
  const menu = async (item: string) => {
    await owner.getByRole("button", { name: `Actions for ${address}` }).click();
    await owner.getByRole("menuitem", { name: item }).click();
  };
  let secret = "";

  await test.step("the owner makes a webhook and sees its secret once", async () => {
    await owner.goto(`/teams/${team}/settings?tab=webhooks`);
    await expect(owner.getByRole("tab", { name: "Webhooks" })).toHaveAttribute("aria-selected", "true");
    await expect(owner.getByText("No webhooks yet.")).toBeVisible();
    await a11y(owner, "team webhooks: none yet");
    await owner.getByRole("button", { name: "New webhook" }).click();
    const dialog = owner.getByRole("dialog", { name: "New webhook" });
    await expect(dialog.getByText("*.example.com")).toBeVisible();
    // The address must be an approved destination: the server's answer is on the field.
    await dialog.getByRole("textbox", { name: /Address/ }).fill("https://hooks.example.net/grounded");
    await dialog.getByRole("checkbox", { name: /agent\.published/ }).check();
    await dialog.getByRole("button", { name: "Create webhook" }).click();
    await expect(dialog.getByText(/not an approved destination/)).toBeVisible();
    await a11y(owner, "new webhook: destination not approved");
    await dialog.getByRole("textbox", { name: /Address/ }).fill(address);
    await dialog.getByRole("textbox", { name: /Description/ }).fill("E2E receiver");
    await dialog.getByRole("button", { name: "Create webhook" }).click();
    const created = owner.getByRole("dialog", { name: "Webhook created" });
    secret = (await created.getByRole("group", { name: "Signing secret" }).locator("code").innerText()).trim();
    expect(secret).toMatch(/^whsec_/);
    await expect(created).toContainText("It won't be shown again");
    await expect(created).toContainText("Grounded-Signature");
    await a11y(owner, "webhook created: the secret");
    await created.getByRole("button", { name: "Done" }).click();
    await expect(created).toHaveCount(0);
    // Focus returns to the button that made the webhook.
    await expect(owner.getByRole("button", { name: "New webhook" })).toBeFocused();
    await expect(row()).toContainText("E2E receiver");
    await expect(row()).toContainText("On");
    await expect(row()).toContainText(`whsec_…${secret.slice(-4)}`);
    await expect(owner.getByText(secret)).toHaveCount(0);
    await a11y(owner, "team webhooks: one");
  });

  await test.step("Send test event shows a delivery that is not delivered", async () => {
    await menu("Deliveries…");
    const panel = owner.getByRole("dialog", { name: "Deliveries" });
    await expect(panel.getByText("Nothing has been sent yet.")).toBeVisible();
    await panel.getByRole("button", { name: "Send test event" }).click();
    const delivery = panel.getByRole("row", { name: /webhook\.test/ });
    await expect(delivery).toBeVisible();
    // The host does not resolve here: the delivery waits to retry, or has failed; it is never delivered.
    await expect(delivery).toContainText(/Pending|Failed/);
    await expect(delivery).not.toContainText("Delivered");
    await a11y(owner, "deliveries panel");
    await panel.getByRole("button", { name: "Close" }).last().click();
    await expect(panel).toHaveCount(0);
  });

  await test.step("the owner changes the description", async () => {
    await menu("Edit…");
    const dialog = owner.getByRole("dialog", { name: "Edit webhook" });
    await expect(dialog.getByRole("textbox", { name: /Address/ })).toHaveValue(address);
    await dialog.getByRole("textbox", { name: /Description/ }).fill("E2E receiver, renamed");
    await a11y(owner, "edit webhook");
    await dialog.getByRole("button", { name: "Save webhook" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row()).toContainText("E2E receiver, renamed");
  });

  await test.step("rotating the secret shows a new one once", async () => {
    await menu("Rotate secret…");
    const confirm = owner.getByRole("alertdialog");
    await a11y(owner, "rotate secret: confirm");
    await confirm.getByRole("button", { name: "Rotate secret" }).click();
    const rotated = owner.getByRole("dialog", { name: "New webhook secret" });
    const next = (await rotated.getByRole("group", { name: "Signing secret" }).locator("code").innerText()).trim();
    expect(next).toMatch(/^whsec_/);
    expect(next).not.toBe(secret);
    await a11y(owner, "rotated secret");
    await rotated.getByRole("button", { name: "Done" }).click();
    await expect(row()).toContainText(`whsec_…${next.slice(-4)}`);
  });

  await test.step("deleting asks first, and then the list is empty", async () => {
    await menu("Delete…");
    const confirm = owner.getByRole("alertdialog");
    await expect(confirm).toContainText("delivery log is deleted too");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(row()).toBeVisible();
    await menu("Delete…");
    await owner.getByRole("alertdialog").getByRole("button", { name: "Delete webhook" }).click();
    await expect(owner.getByText("No webhooks yet.")).toBeVisible();
    await a11y(owner, "team webhooks: deleted");
  });
});
