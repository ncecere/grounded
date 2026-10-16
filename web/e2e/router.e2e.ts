import { Api } from "./support/api";
import { chatModel, createTeam, handbook, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * A router agent (v0.6.0, C5): a team member asks the front door a question, the parking agent answers it and is named, "Continue there"
 * opens the conversation with that agent, and a question nobody covers gets the router's own words. The editor lists what the router can
 * reach, and a router is not offered the switch that makes it reachable.
 */
test("a router sends the question to the right agent, names it, and continues there", async ({ as, a11y }) => {
  test.setTimeout(180_000);
  const ownerApi = await Api.signIn("alex");
  const team = await createTeam(await Api.signIn("admin"), ownerApi, { prefix: "router", members: { blair: "member" } });
  const { agent: parking } = await publishedAgent(ownerApi, team, { name: "Parking helper", description: "Student parking permits and decals", config: { routable: true } });
  const model = await chatModel(ownerApi);
  const router = await ownerApi.post<{ id: string; slug: string }>(`/v1/teams/${team}/agents`, {
    name: "Front door",
    description: "Finds the right assistant",
    config: { chatModelId: model.id, kbs: [], router: true, instructions: "Send each question to the assistant that covers it.", systemOne: { scope: "on" } },
  });
  await ownerApi.post(`/v1/teams/${team}/agents/${router.id}/publish`, { note: "E2E" }, { expect: 201 });
  await ownerApi.dispose();

  const owner = await as("alex");
  await test.step("the editor sees what the router can reach, and no switch on the router itself", async () => {
    await owner.goto(`/teams/${team}/agents/${router.id}`);
    await owner.getByRole("button", { name: /^Routing/ }).click();
    const reach = owner.getByRole("region", { name: "Agents this router can reach" });
    await expect(reach.getByRole("listitem")).toHaveText([/Parking helper/]);
    await expect(owner.getByRole("button", { name: /^Knowledge/ })).toHaveCount(0);
    await a11y(owner, "a router's Build tab");
    await owner.goto(`/teams/${team}/agents/${router.id}?tab=share`);
    await expect(owner.getByRole("heading", { name: "Audience" })).toBeVisible();
    await expect(owner.getByRole("switch", { name: "Can be reached through routers" })).toHaveCount(0);
    await a11y(owner, "a router's Share tab");
    await owner.goto(`/teams/${team}/agents/${parking.id}?tab=share`);
    await expect(owner.getByRole("switch", { name: "Can be reached through routers" })).toBeChecked();
    await a11y(owner, "Share: Routers");
  });

  const member = await as("blair");
  await test.step("a member asks the front door and the parking agent answers", async () => {
    await member.goto(`/a/${team}/${router.slug}`);
    const composer = member.getByRole("textbox", { name: "Message Front door" });
    await expect(composer).toBeEnabled();
    await composer.fill("How much is a student parking permit?");
    await composer.press("Enter");
    const answer = member.getByRole("article", { name: "Front door said" });
    await expect(answer).toContainText(handbook.answer);
    await expect(answer.getByText(/Answered by/)).toHaveText("Answered by Parking helper · E2E " + team);
    await a11y(member, "a routed answer");
    await answer.getByRole("link", { name: "Continue there" }).click();
    await expect(member).toHaveURL(new RegExp(`/a/${team}/${parking.slug}\\?c=`));
    await expect(member.getByRole("article", { name: "Parking helper said" })).toContainText(handbook.answer);
    await expect(member.getByRole("article", { name: "You said" })).toContainText("How much is a student parking permit?");
    await a11y(member, "the conversation continued with the answering agent");
  });

  await test.step("a question nobody covers gets the router's own words", async () => {
    await member.goto(`/a/${team}/${router.slug}`);
    const composer = member.getByRole("textbox", { name: "Message Front door" });
    await composer.fill("NOAGENT Who won the football game?");
    await composer.press("Enter");
    const answer = member.getByRole("article", { name: "Front door said" });
    await expect(answer).toContainText("I couldn't find an assistant here that covers that");
    await expect(answer.getByText(/Answered by/)).toHaveCount(0);
    await a11y(member, "a router's refusal");
  });
});
