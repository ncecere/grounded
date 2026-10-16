/* Agent templates (v0.6.0, C4): "Start from" in New agent, Admin → Agent templates, and "Save as template…" in an agent's "…" menu. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { type Handler, Reply, mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const baseConfig: Schemas["AgentConfig"] = {
  instructions: "",
  chatModelId: null,
  kbs: [],
  retrievalMode: "always",
  maxTurns: 4,
  contextTokenBudget: 6000,
  minSimilarity: 0,
  strictlyGrounded: true,
  refusalMessage: "I couldn't find that.",
  citationMode: "snippet_link",
  queryRewrite: true,
  moderation: { categories: {}, outputMode: "" },
  audience: "team",
};

const faq: Schemas["AgentTemplate"] = {
  id: "service-desk-faq",
  name: "Service desk FAQ",
  description: "Answers common how-do-I questions in short steps.",
  builtIn: true,
  accentColor: "",
  welcomeMessage: "Hi! What do you need help with?",
  starterQuestions: ["How do I reset my password?"],
  config: { ...baseConfig, instructions: "You answer questions for people who need help." },
};
const saved: Schemas["AgentTemplate"] = {
  id: "7f1c1a0e-3b2a-4d59-9a57-2f0f5b4d8c11",
  name: "Registrar helper",
  description: "Short answers about records.",
  builtIn: false,
  accentColor: "#1a56db",
  welcomeMessage: "Ask the registrar.",
  starterQuestions: [],
  createdAt: "2026-10-15T10:00:00Z",
  config: { ...baseConfig, instructions: "Always answer in two sentences.", chatModelId: "mod2", strictlyGrounded: false },
};

const models = [
  { id: "mod1", key: "a", displayName: "Model one", description: "", maxClassification: "sensitive", contextWindow: 131072, maxOutputTokens: 4096, supportsTools: true, supportsVision: false, health: { status: "healthy" } },
  { id: "mod2", key: "b", displayName: "Model two", description: "", maxClassification: "sensitive", contextWindow: 131072, maxOutputTokens: 4096, supportsTools: true, supportsVision: false, health: { status: "healthy" } },
];

const teamKB = { id: "kb1", name: "Registrar help", description: "", embeddingProfileId: "p1", topK: 8, effectiveClassification: "open", sources: [], revision: 1, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" };

const createdAgent = { id: "ag9", teamId: "t1", teamSlug: "registrar", slug: "help", name: "Help", description: "", accentColor: "", welcomeMessage: "", starterQuestions: [], status: "active", disabledReason: "", disabledAt: null, audience: "team", draft: baseConfig, draftRevision: 1, published: null, hasUnpublishedChanges: false, warnings: [], revision: 1, createdAt: "2026-10-15T10:00:00Z", updatedAt: "2026-10-15T10:00:00Z" };

const routes = (role: Parameters<typeof shellRoutes>[0], extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes(role),
  "GET /v1/agent-templates": () => [faq, saved],
  "GET /v1/chat-models": () => models,
  "GET /v1/teams/registrar/kbs": () => [teamKB],
  "GET /v1/teams/registrar/agents": () => [],
  "GET /v1/teams/registrar/agents/ag9": () => createdAgent,
  ...extra,
});

describe("New agent: Start from", () => {
  it("offers a blank agent and every template, says what the chosen one is, and sends only what the person chose with it", async () => {
    const calls = mockApi(routes("none", { "POST /v1/teams/registrar/agents": () => createdAgent }));
    renderApp("/teams/registrar/agents");
    await userEvent.click(await screen.findByRole("button", { name: "New agent" }));
    const dialog = await screen.findByRole("dialog", { name: "New agent" });
    const start = await within(dialog).findByRole("combobox", { name: "Start from" });
    expect(within(start).getAllByRole("option").map((o) => o.textContent)).toEqual(["A blank agent", "Service desk FAQ", "Registrar helper"]);
    expect(dialog).toHaveTextContent("A template brings good instructions and settings");

    await userEvent.selectOptions(start, "Service desk FAQ");
    expect(dialog).toHaveTextContent("Answers common how-do-I questions in short steps.");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Help");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Registrar help/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create agent" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/v1/teams/registrar/agents")).toBe(true));
    const body = calls.find((c) => c.method === "POST" && c.url === "/v1/teams/registrar/agents")!.body as { templateId?: string; config: Record<string, unknown> };
    expect(body.templateId).toBe("service-desk-faq");
    // Nothing of the defaults travels with a template: its instructions and settings are the server's to apply.
    expect(Object.keys(body.config).sort()).toEqual(["chatModelId", "kbs"]);
    expect(body.config.kbs).toEqual([{ kbId: "kb1" }]);
  });

  it("a blank agent sends the defaults and no template; a saved template's model is picked when the platform still offers it", async () => {
    const calls = mockApi(routes("none", { "POST /v1/teams/registrar/agents": () => createdAgent }));
    renderApp("/teams/registrar/agents");
    await userEvent.click(await screen.findByRole("button", { name: "New agent" }));
    const dialog = await screen.findByRole("dialog", { name: "New agent" });
    const start = await within(dialog).findByRole("combobox", { name: "Start from" });
    await userEvent.selectOptions(start, "Registrar helper");
    expect(within(dialog).getByRole("combobox", { name: /Chat model/ })).toHaveTextContent("Model two");
    await userEvent.selectOptions(start, "A blank agent");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Plain");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create agent" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/v1/teams/registrar/agents")).toBe(true));
    const body = calls.find((c) => c.method === "POST" && c.url === "/v1/teams/registrar/agents")!.body as { templateId?: string; config: Record<string, unknown> };
    expect(body.templateId).toBeUndefined();
    expect(body.config).toMatchObject({ maxTurns: 4, strictlyGrounded: true });
  });

  it("has no Start from when the templates cannot be listed", async () => {
    mockApi(routes("none", { "GET /v1/agent-templates": () => Reply.error(403, "forbidden", "Only team editors can use agent templates") }));
    renderApp("/teams/registrar/agents");
    await userEvent.click(await screen.findByRole("button", { name: "New agent" }));
    const dialog = await screen.findByRole("dialog", { name: "New agent" });
    await within(dialog).findByRole("textbox", { name: "Name" });
    expect(within(dialog).queryByRole("combobox", { name: "Start from" })).toBeNull();
  });
});

describe("Admin → Agent templates", () => {
  it("lists built-in and saved templates; built-in ones can only be viewed", async () => {
    mockApi(routes("platform_admin"));
    const { container } = renderApp("/admin/agent-templates");
    const table = await screen.findByRole("table", { name: "Agent templates" }, { timeout: scaled(5000) });
    const builtIn = await within(table).findByRole("row", { name: /Service desk FAQ/ });
    expect(builtIn).toHaveTextContent("Built in");
    expect(builtIn).toHaveTextContent("Ships with Grounded");
    expect(within(table).getByRole("row", { name: /Registrar helper/ })).toHaveTextContent("Saved from an agent");
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(table).getByRole("button", { name: "Actions for Service desk FAQ" }));
    expect(await screen.findByRole("menuitem", { name: "View…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Rename…" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete…" })).toBeNull();
  });

  it("shows what a template holds, read only", async () => {
    mockApi(routes("platform_admin"));
    renderApp("/admin/agent-templates");
    const table = await screen.findByRole("table", { name: "Agent templates" }, { timeout: scaled(5000) });
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Registrar helper" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "View…" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar helper" });
    expect(within(dialog).getByRole("textbox", { name: "Instructions" })).toHaveValue("Always answer in two sentences.");
    expect(within(dialog).getByRole("textbox", { name: "Instructions" })).toHaveAttribute("readonly");
    expect(dialog).toHaveTextContent("May also answer from general knowledge");
    expect(dialog).toHaveTextContent("Names a chat model");
    expect(dialog).toHaveTextContent("Never holds knowledge bases, tools or an audience");
    // Two Close buttons: the corner one and the footer's; the footer's is the last.
    await userEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renames a saved template, and says when the name is taken", async () => {
    let taken = true;
    const calls = mockApi(
      routes("platform_admin", {
        "PATCH /v1/admin/agent-templates/7f1c1a0e-3b2a-4d59-9a57-2f0f5b4d8c11": () =>
          taken ? Reply.error(409, "template_name_taken", "A template with that name already exists") : { ...saved, name: "Records helper" },
      }),
    );
    renderApp("/admin/agent-templates");
    const table = await screen.findByRole("table", { name: "Agent templates" }, { timeout: scaled(5000) });
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Registrar helper" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rename…" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename template" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Enter a name.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);

    await userEvent.type(name, "Service desk faq");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("A template with that name already exists.")).toBeInTheDocument();
    taken = false;
    await userEvent.clear(name);
    await userEvent.type(name, "Records helper");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename template" })).toBeNull());
    const sent = calls.filter((c) => c.method === "PATCH").at(-1)!;
    expect(sent.body).toEqual({ name: "Records helper", description: "Short answers about records." });
  });

  it("deletes a saved template after confirmation, and Cancel deletes nothing", async () => {
    const calls = mockApi(routes("platform_admin", { "DELETE /v1/admin/agent-templates/7f1c1a0e-3b2a-4d59-9a57-2f0f5b4d8c11": () => ({ ok: true }) }));
    renderApp("/admin/agent-templates");
    const table = await screen.findByRole("table", { name: "Agent templates" }, { timeout: scaled(5000) });
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Registrar helper" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("keep their own copy");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    await userEvent.click(within(table).getByRole("button", { name: "Actions for Registrar helper" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete template" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("is read only for an auditor", async () => {
    mockApi(routes("platform_auditor"));
    renderApp("/admin/agent-templates");
    const table = await screen.findByRole("table", { name: "Agent templates" }, { timeout: scaled(5000) });
    expect(await screen.findByText(/Auditors can view the templates/)).toBeInTheDocument();
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Registrar helper" }));
    expect(await screen.findByRole("menuitem", { name: "View…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Rename…" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete…" })).toBeNull();
  });
});

describe("Save as template…", () => {
  const editorRoutes = (role: Parameters<typeof shellRoutes>[0], extra: Record<string, Handler> = {}) =>
    routes(role, {
      "GET /v1/teams/registrar/agents/ag9/versions": () => [],
      ...extra,
    });

  it("is only in the menu of a platform admin", async () => {
    mockApi(editorRoutes("none"));
    renderApp("/teams/registrar/agents/ag9");
    await userEvent.click(await screen.findByRole("button", { name: "More actions" }, { timeout: scaled(5000) }));
    await screen.findByRole("menuitem", { name: "Delete agent…" });
    expect(screen.queryByRole("menuitem", { name: "Save as template…" })).toBeNull();
  });

  it("saves the agent as a template, with its name and description to start from, and says when the name is taken", async () => {
    let taken = true;
    const calls = mockApi(
      editorRoutes("platform_admin", {
        "POST /v1/teams/registrar/agents/ag9/save-as-template": () =>
          taken ? Reply.error(409, "template_name_taken", "A template with that name already exists") : new Reply(201, { data: saved }),
      }),
    );
    renderApp("/teams/registrar/agents/ag9");
    await userEvent.click(await screen.findByRole("button", { name: "More actions" }, { timeout: scaled(5000) }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Save as template…" }));
    const dialog = await screen.findByRole("dialog", { name: "Save as a template" });
    expect(within(dialog).getByRole("textbox", { name: "Template name" })).toHaveValue("Help");
    expect(dialog).toHaveTextContent("Everyone who makes an agent can read the instructions");
    expect(dialog).toHaveTextContent("never keeps the knowledge bases, the tools or who may use the agent");

    await userEvent.click(within(dialog).getByRole("button", { name: "Save template" }));
    expect(await within(dialog).findByText("A template with that name already exists.")).toBeInTheDocument();
    // Cancel leaves everything as it was.
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save as a template" })).toBeNull());

    taken = false;
    await userEvent.click(await screen.findByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Save as template…" }));
    const again = await screen.findByRole("dialog", { name: "Save as a template" });
    const name = within(again).getByRole("textbox", { name: "Template name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Registrar helper");
    await userEvent.click(within(again).getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save as a template" })).toBeNull());
    const sent = calls.filter((c) => c.method === "POST" && c.url.endsWith("/save-as-template")).at(-1)!;
    expect(sent.body).toEqual({ name: "Registrar helper", description: "" });
  });
});
