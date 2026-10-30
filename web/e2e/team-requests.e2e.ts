import { scaled } from "../test-scale";
import { Api, type Schemas } from "./support/api";
import { unique } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * In-app team requests (v0.6.0, E3), across two people: a platform admin turns the feature on; a user asks for a team from the workspace
 * switcher; the admin approves it (with a first agent from a template) and declines a second request with a reason; the user sees both
 * outcomes; the admin turns the feature off and the page says so. The switch is the platform's, so the test puts it back.
 */
test("team requests: turn on, ask, approve with a first agent, decline with a reason, turn off", async ({ as, admin, a11y }) => {
  test.setTimeout(scaled(120_000));
  const requester = await Api.signIn("user");
  // A retry starts clean: nothing the person left open counts against their limit.
  for (const r of (await requester.get<Schemas["TeamRequestsOverview"]>("/v1/team-requests")).items.filter((i) => i.status === "pending")) {
    await requester.post(`/v1/team-requests/${r.id}/withdraw`);
  }
  await requester.dispose();
  await admin.putRevised("/v1/admin/settings/team-requests", { enabled: false, maxOpen: 2, allowedGroup: "" });

  const approved = unique("E2E approved");
  const declined = unique("E2E declined");
  const slug = unique("req");
  const platform = await as("admin");
  const person = await as("user");
  try {
    await test.step("a platform admin turns team requests on", async () => {
      await platform.goto("/admin/settings");
      const sw = platform.getByRole("switch", { name: "Allow team requests" });
      await expect(sw).not.toBeChecked();
      await a11y(platform, "settings: team requests off");
      await sw.click();
      await expect(sw).toBeChecked();
      await platform.getByRole("button", { name: "Who may ask…" }).click();
      const dialog = platform.getByRole("dialog", { name: "Who may ask for a team" });
      await expect(dialog.getByLabel(/Open requests per person/)).toHaveValue("2");
      await a11y(platform, "who may ask for a team");
      await dialog.getByRole("button", { name: "Cancel" }).click();
    });

    await test.step("the user finds the request page from the workspace switcher and asks", async () => {
      await person.goto("/");
      await expect(person.getByRole("heading", { level: 1 })).toBeVisible();
      await a11y(person, "home");
      await person.getByRole("button", { name: /Current workspace/ }).click();
      await person.getByRole("menuitem", { name: "Request a new team" }).click();
      await expect(person.getByRole("heading", { level: 1, name: "Request a team" })).toBeVisible();
      await a11y(person, "request a team");
      for (const { name, why } of [{ name: approved, why: "Run the approved team." }, { name: declined, why: "Run the declined team." }]) {
        await person.getByRole("button", { name: "New request" }).click();
        const dialog = person.getByRole("dialog", { name: "Request a team" });
        // Sending an empty form says what is missing and sends nothing.
        await dialog.getByRole("button", { name: "Send request" }).click();
        await expect(dialog.getByText("Enter a name.")).toBeVisible();
        await a11y(person, "request a team: errors");
        await dialog.getByLabel("Team name").fill(name);
        await dialog.getByLabel("What is it for?").fill(why);
        await dialog.getByLabel(/Highest classification/).selectOption({ label: "Open" });
        await dialog.getByRole("button", { name: "Send request" }).click();
        await expect(dialog).toHaveCount(0);
        await expect(person.getByRole("row", { name: new RegExp(name) })).toContainText("Waiting for review");
      }
      // Two open requests is the limit: the page says so.
      await expect(person.getByRole("button", { name: "New request" })).toBeDisabled();
      await expect(person.getByText(/You have as many open requests as allowed/)).toBeVisible();
    });

    await test.step("a platform admin approves one with a first agent and declines the other", async () => {
      await platform.goto("/admin/teams?tab=requests");
      const table = platform.getByRole("table", { name: "Team requests" });
      await expect(table.getByRole("row", { name: new RegExp(approved) })).toContainText("Waiting for review");
      await a11y(platform, "team requests queue");

      await table.getByRole("button", { name: `Actions for ${approved}` }).click();
      await platform.getByRole("menuitem", { name: "Approve…" }).click();
      const dialog = platform.getByRole("dialog", { name: new RegExp(`Approve "${approved}"`) });
      await dialog.getByLabel("Address").fill(slug);
      await dialog.getByLabel(/First agent/).selectOption({ label: "Service desk FAQ" });
      await a11y(platform, "approve a team request");
      await dialog.getByRole("button", { name: "Approve and create the team" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(table.getByRole("row", { name: new RegExp(approved) })).toContainText("Approved");

      await table.getByRole("button", { name: `Actions for ${declined}` }).click();
      await platform.getByRole("menuitem", { name: "Decline…" }).click();
      const no = platform.getByRole("dialog", { name: new RegExp(`Decline "${declined}"`) });
      await no.getByRole("button", { name: "Decline request" }).click();
      await expect(no.getByText(/Say why/)).toBeVisible();
      await no.getByLabel("Reason").fill("The Library team already covers this.");
      await no.getByRole("button", { name: "Decline request" }).click();
      await expect(no).toHaveCount(0);
      await expect(table.getByRole("row", { name: new RegExp(declined) })).toContainText("Declined");
    });

    await test.step("the user sees both outcomes and opens the new team with its first agent", async () => {
      await person.goto("/team-requests");
      const table = person.getByRole("table", { name: "Your team requests" });
      await expect(table.getByRole("row", { name: new RegExp(approved) })).toContainText("Approved");
      await expect(table.getByRole("row", { name: new RegExp(declined) })).toContainText("The Library team already covers this.");
      await expect(person.getByRole("button", { name: "New request" })).toBeEnabled();
      await a11y(person, "request a team: decided");
      await table.getByRole("link", { name: new RegExp(`Open ${approved}`) }).click();
      await expect(person).toHaveURL(new RegExp(`/teams/${slug}`));
      await expect(person.getByRole("heading", { level: 1 })).toBeVisible();
      await a11y(person, "the new team");
      await person.goto(`/teams/${slug}/agents`);
      await expect(person.getByRole("table", { name: "Agents" }).getByRole("row", { name: /Service desk FAQ/ })).toBeVisible();
      await a11y(person, "the new team's agents");
    });

    await test.step("turning the feature off says so on the user's page and keeps their history", async () => {
      await platform.goto("/admin/settings");
      await platform.getByRole("switch", { name: "Allow team requests" }).click();
      const confirm = platform.getByRole("alertdialog");
      await a11y(platform, "turn team requests off");
      await confirm.getByRole("button", { name: "Turn team requests off" }).click();
      await expect(platform.getByRole("switch", { name: "Allow team requests" })).not.toBeChecked();
      await person.goto("/team-requests");
      await expect(person.getByText(/Team requests aren't turned on here/)).toBeVisible();
      await expect(person.getByRole("button", { name: "New request" })).toBeDisabled();
      await expect(person.getByRole("row", { name: new RegExp(approved) })).toBeVisible();
    });
  } finally {
    await admin.putRevised("/v1/admin/settings/team-requests", { enabled: false, maxOpen: 2, allowedGroup: "" });
  }
});
