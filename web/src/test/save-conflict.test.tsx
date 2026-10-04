/* Save conflicts on settings forms (AD-01): the person's edits survive a change made elsewhere and a 412, they see what changed, and choose. */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { humanize, initialRevisionState, isOwnSave, rebase, reconcile, serverChanges } from "../components/templates/revision-form";
import { mockApi, renderApp, Reply, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
  // Browsers' scrollIntoView may return a promise (smooth scrolling): an effect returning it broke the page.
  Element.prototype.scrollIntoView = () => Promise.resolve() as unknown as void;
});

type F = { name: string; description: string; level: string };
const base: F = { name: "Library", description: "Old", level: "open" };

describe("revision form helpers", () => {
  it("lists what changed elsewhere, with the person's own value where they changed it too", () => {
    const mine = { ...base, description: "Mine" };
    const theirs = { ...base, description: "Theirs", name: "Library services" };
    expect(serverChanges(base, rebase(base, mine, theirs), theirs, { description: "Description" })).toEqual([
      { key: "name", label: "Name", theirs: "Library services", mine: "Library services", clash: false },
      { key: "description", label: "Description", theirs: "Theirs", mine: "Mine", clash: true },
    ]);
    expect(humanize("maxClassification")).toBe("Max classification");
  });

  it("rebases the person's changes onto the latest version", () => {
    expect(rebase(base, { ...base, description: "Mine" }, { ...base, name: "New", description: "Theirs" })).toEqual({ ...base, name: "New", description: "Mine" });
  });

  it("follows a new revision quietly while the form is untouched", () => {
    const s = reconcile(initialRevisionState(base, 1), { ...base, name: "New" }, 2);
    expect(s.form.name).toBe("New");
    expect(s.theirs).toBeNull();
  });

  it("keeps edits and records the other version when it changed a field the form shows", () => {
    const edited = { ...initialRevisionState(base, 1), form: { ...base, description: "Mine" } };
    const s = reconcile(edited, { ...base, description: "Theirs", level: "sensitive" }, 2);
    expect(s.form).toEqual({ ...base, description: "Mine", level: "sensitive" });
    expect(s.theirs?.revision).toBe(2);
    expect(s.revision).toBe(1);
  });

  it("tells the person's own save (tidied by the server) from someone else's", () => {
    const sent = { ...base, name: "Library  ", description: "New" };
    expect(isOwnSave(base, sent, { ...base, name: "Library", description: "New" })).toBe(true);
    expect(isOwnSave(base, sent, { ...base, description: "Theirs" })).toBe(false);
  });

  it("a submit that never saved (an invalid field) doesn't make someone else's version look like the person's own", () => {
    const typed = { ...base, description: "Mine" };
    const s = reconcile({ ...initialRevisionState(base, 1), form: typed, submitted: typed }, { ...base, description: "Theirs" }, 2);
    expect(s.form.description).toBe("Mine");
    expect(s.theirs?.values.description).toBe("Theirs");
  });

  it("takes the server's values after the person's own save, and waits while a save is in flight", () => {
    const sent = { ...base, name: "Library " };
    const saving = { ...initialRevisionState(base, 1), form: sent, submitted: sent, saving: true };
    expect(reconcile(saving, { ...base, name: "Library" }, 2)).toBe(saving);
    const s = reconcile({ ...saving, saving: false }, { ...base, name: "Library" }, 2);
    expect(s.form.name).toBe("Library");
    expect(s.theirs).toBeNull();
  });
});

const team: Schemas["Team"] = {
  id: "t1",
  slug: "registrar",
  name: "Office of the Registrar",
  description: "Desc 1",
  maxClassification: "sensitive",
  status: "active",
  revision: 2,
  createdAt: "",
  updatedAt: "",
};
const summary = (t: Schemas["Team"]): Schemas["TeamSummary"] => ({ team: t, memberCount: 3, ownerCount: 1, agentCount: 4, sourceCount: 2, kbCount: 1, documentCount: 40, storageBytes: 1 });

/** The admin team page whose server copy can be changed "in another tab". */
function server() {
  let current = team;
  const calls = mockApi({
    ...shellRoutes("platform_admin"),
    "GET /v1/admin/teams/registrar": () => summary(current),
    "PATCH /v1/admin/teams/registrar": (body, call) => {
      if (call.headers.get("If-Match") !== `"${current.revision}"`) return Reply.error(412, "revision_conflict", "Someone else changed this since you loaded it. Reload and try again.");
      current = { ...current, ...(body as Partial<Schemas["Team"]>), revision: current.revision + 1 };
      return current;
    },
  });
  return { calls, elsewhere: (patch: Partial<Schemas["Team"]>) => (current = { ...current, ...patch, revision: current.revision + 1 }) };
}

describe("a settings form's save conflict (admin team settings)", () => {
  it("keeps what was typed after a 412, shows what changed and overwrites on purpose", async () => {
    const user = userEvent.setup();
    const { calls, elsewhere } = server();
    const { container } = renderApp("/admin/teams/registrar?tab=settings");
    const description = await screen.findByRole("textbox", { name: /Description/ });
    elsewhere({ description: "Desc B" });
    await user.clear(description);
    await user.type(description, "Desc A2 important");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const list = await screen.findByRole("list", { name: "Changed elsewhere" });
    expect(within(list).getByText(/now “Desc B” \(yours: “Desc A2 important”\)/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Description/ })).toHaveValue("Desc A2 important");
    expect(screen.queryByText(/Reload and try again/)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("button", { name: "Overwrite with mine" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Changed elsewhere" })).toBeNull());
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1]!.headers.get("If-Match")).toBe('"3"');
    expect(patches[1]!.body).toMatchObject({ description: "Desc A2 important" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull());
    expect(screen.getByRole("textbox", { name: /Description/ })).toHaveValue("Desc A2 important");
  });

  it("discards the edits and loads the other version on request", async () => {
    const user = userEvent.setup();
    const { calls, elsewhere } = server();
    renderApp("/admin/teams/registrar?tab=settings");
    const description = await screen.findByRole("textbox", { name: /Description/ });
    elsewhere({ description: "Desc B", name: "Registrar" });
    await user.type(description, " mine");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(await screen.findByRole("button", { name: "Discard mine and load theirs" }));
    expect(screen.getByRole("textbox", { name: /Description/ })).toHaveValue("Desc B");
    expect(screen.getByRole("textbox", { name: /Name/ })).toHaveValue("Registrar");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Overwrite with mine" })).toBeNull());
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("notices a change made elsewhere while editing, before Save, and takes it into untouched fields", async () => {
    const user = userEvent.setup();
    const { elsewhere } = server();
    const { qc } = renderApp("/admin/teams/registrar?tab=settings");
    const description = await screen.findByRole("textbox", { name: /Description/ });
    await user.type(description, " mine");
    elsewhere({ name: "Registrar", description: "Desc B" });
    await act(() => qc.invalidateQueries({ queryKey: ["admin"] }));
    expect(await screen.findByRole("list", { name: "Changed elsewhere" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Name/ })).toHaveValue("Registrar");
    expect(screen.getByRole("textbox", { name: /Description/ })).toHaveValue("Desc 1 mine");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("after a successful save, shows the saved (tidied) values with no conflict", async () => {
    const user = userEvent.setup();
    server();
    renderApp("/admin/teams/registrar?tab=settings");
    const name = await screen.findByRole("textbox", { name: /Name/ });
    await user.type(name, " ");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull());
    expect(screen.queryByRole("list", { name: "Changed elsewhere" })).toBeNull();
    expect(screen.getByRole("textbox", { name: /Name/ })).toHaveValue("Office of the Registrar");
  });
});
