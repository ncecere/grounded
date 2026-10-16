import { Api } from "./support/api";
import { createTeam, unique } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * Agent templates (v0.6.0, C4), across two people: an editor starts an agent from a built-in template; a platform admin who is also on the
 * team saves it as a template, renames it and deletes it; the editor sees the saved template in New agent while it exists.
 */
test("agent templates: start from one, save one, rename and delete it", async ({ as, admin, a11y }) => {
  test.setTimeout(120_000);
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "tmpl", members: { admin: "editor" } });
  await owner.dispose();
  const editor = await as("alex");
  const saved = unique("E2E template");
  const renamed = unique("E2E renamed");
  let agentUrl = "";

  await test.step("start an agent from a built-in template", async () => {
    await editor.goto(`/teams/${team}/agents`);
    await editor.getByRole("button", { name: "New agent" }).first().click();
    const dialog = editor.getByRole("dialog", { name: "New agent" });
    const start = dialog.getByRole("combobox", { name: "Start from" });
    await expect(start.getByRole("option")).toHaveText(["A blank agent", "Service desk FAQ", "Policy explainer", "Course helper", "Public website assistant", "Internal knowledge assistant", "Front door (router)"]);
    await start.selectOption({ label: "Service desk FAQ" });
    await expect(dialog).toContainText("Answers common how-do-I questions");
    await dialog.getByLabel("Name").fill("Template agent");
    await a11y(editor, "new agent: start from a template");
    await dialog.getByRole("button", { name: "Create agent" }).click();
    await expect(editor.getByRole("heading", { level: 1, name: "Template agent" })).toBeVisible();
    // The template's instructions are in the draft, and a template never made it public.
    await expect(editor.getByRole("textbox", { name: "Instructions" })).toHaveValue(/You answer questions for people who need help/);
    await expect(editor.getByText("Team (when published)").first()).toBeVisible();
    agentUrl = new URL(editor.url()).pathname;
    await a11y(editor, "agent made from a template");
  });

  const platform = await as("admin");
  await test.step("a platform admin on the team saves the agent as a template", async () => {
    // Only a platform admin has the item: the editor's menu does not.
    await editor.getByRole("button", { name: "More actions" }).click();
    await expect(editor.getByRole("menuitem", { name: "Delete agent…" })).toBeVisible();
    await expect(editor.getByRole("menuitem", { name: "Save as template…" })).toHaveCount(0);
    await editor.keyboard.press("Escape");

    await platform.goto(agentUrl);
    await expect(platform.getByRole("heading", { level: 1, name: "Template agent" })).toBeVisible();
    await platform.getByRole("button", { name: "More actions" }).click();
    await platform.getByRole("menuitem", { name: "Save as template…" }).click();
    const dialog = platform.getByRole("dialog", { name: "Save as a template" });
    await expect(dialog.getByLabel("Template name")).toHaveValue("Template agent");
    await a11y(platform, "save as a template");
    // A built-in name is taken; Cancel saves nothing.
    await dialog.getByLabel("Template name").fill("Service desk FAQ");
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(dialog.getByText("A template with that name already exists.")).toBeVisible();
    await dialog.getByLabel("Template name").fill(saved);
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step("the editor sees it in New agent", async () => {
    await editor.goto(`/teams/${team}/agents`);
    await editor.getByRole("button", { name: "New agent" }).first().click();
    const start = editor.getByRole("dialog", { name: "New agent" }).getByRole("combobox", { name: "Start from" });
    await expect(start.getByRole("option", { name: saved })).toHaveCount(1);
    await editor.keyboard.press("Escape");
  });

  await test.step("the platform admin views, renames and deletes it; built-in ones can only be viewed", async () => {
    await platform.goto("/admin/agent-templates");
    await expect(platform.getByRole("heading", { level: 1, name: "Agent templates" })).toBeVisible();
    const table = platform.getByRole("table", { name: "Agent templates" });
    await expect(table.getByRole("row", { name: /Service desk FAQ/ })).toContainText("Built in");
    await a11y(platform, "agent templates");

    await table.getByRole("button", { name: "Actions for Service desk FAQ" }).click();
    await expect(platform.getByRole("menuitem", { name: "View…" })).toBeVisible();
    await expect(platform.getByRole("menuitem", { name: "Rename…" })).toHaveCount(0);
    await platform.keyboard.press("Escape");

    await table.getByRole("button", { name: `Actions for ${saved}` }).click();
    await platform.getByRole("menuitem", { name: "View…" }).click();
    const view = platform.getByRole("dialog", { name: saved });
    await expect(view.getByRole("textbox", { name: "Instructions" })).toHaveValue(/You answer questions for people who need help/);
    await a11y(platform, "view a template");
    await view.getByRole("button", { name: "Close" }).last().click();

    await table.getByRole("button", { name: `Actions for ${saved}` }).click();
    await platform.getByRole("menuitem", { name: "Rename…" }).click();
    const rename = platform.getByRole("dialog", { name: "Rename template" });
    await rename.getByLabel("Name").fill(renamed);
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(table.getByRole("row", { name: new RegExp(renamed) })).toBeVisible();
    await expect(table.getByRole("row", { name: new RegExp(saved) })).toHaveCount(0);

    await table.getByRole("button", { name: `Actions for ${renamed}` }).click();
    await platform.getByRole("menuitem", { name: "Delete…" }).click();
    const confirm = platform.getByRole("alertdialog");
    await a11y(platform, "delete a template");
    await confirm.getByRole("button", { name: "Delete template" }).click();
    await expect(table.getByRole("row", { name: new RegExp(renamed) })).toHaveCount(0);
  });

  await test.step("the agent made from it keeps its instructions after the template is gone", async () => {
    await editor.goto(agentUrl);
    await expect(editor.getByRole("textbox", { name: "Instructions" })).toHaveValue(/You answer questions for people who need help/);
  });
});
