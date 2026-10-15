/* The open list of a Combobox, a free-text Combobox and a ModelSelector has an accessible name. A listbox without one is an axe violation
 * (aria-input-field-name, serious), and CI found it in the e2e run: the Team picker's list is in the DOM while its popup is open or closing,
 * and the check passed only when the popup had finished closing first (admin.e2e.ts "retention dry run, and a legal hold placed and released"). */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Combobox } from "@/components/ui/combobox/combobox";
import { Field } from "@/components/ui/field/field";
import { ModelSelector } from "@/components/ui/model-selector/model-selector";
import { TeamPicker } from "../pages/admin/team-picker";
import { mockApi, renderBare, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

const items = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

/** axe over the whole document while a popup is open, with the rule set the e2e check enforces (WCAG A and AA; the best-practice "region"
 * rule is outside it, and a bare component has no landmark around it). */
async function violations() {
  const result = await axe(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 90)).join(" | ")}`);
}

describe("an open list is named", () => {
  it("takes the Combobox's aria-label", async () => {
    render(<Combobox items={items} value={null} onValueChange={() => {}} aria-label="Colour" />);
    await userEvent.click(screen.getByRole("combobox", { name: "Colour" }));
    expect(await screen.findByRole("listbox", { name: "Colour" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  it("takes listLabel over it, so a Combobox named by its Field label can still name its list", async () => {
    render(
      <Field label="Team">
        <Combobox items={items} value={null} onValueChange={() => {}} placeholder="Search teams" listLabel="Teams" />
      </Field>,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Team" })); // the input is named by the Field's label, not by the list's
    const list = await screen.findByRole("listbox", { name: "Teams" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Alpha", "Beta"]);
    expect(await violations()).toEqual([]);
  });

  it("falls back to the placeholder, then to 'Options', so no caller leaves a list unnamed", async () => {
    const { unmount } = render(<Combobox items={items} value={null} onValueChange={() => {}} placeholder="Pick one" />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("listbox", { name: "Pick one" })).toBeInTheDocument();
    unmount();
    render(<Combobox items={items} value={null} onValueChange={() => {}} aria-label="" />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("listbox", { name: "Options" })).toBeInTheDocument();
  });

  it("names the free-text Combobox's list too", async () => {
    render(<Combobox freeText items={items} value="" onValueChange={() => {}} aria-label="Group" />);
    await userEvent.type(screen.getByRole("combobox", { name: "Group" }), "a"); // an autocomplete opens as you type, not on a click
    expect(await screen.findByRole("listbox", { name: "Group" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  it("names the ModelSelector's list with its label", async () => {
    render(
      <ModelSelector
        label="Model"
        models={[
          { id: "m1", name: "Fast", provider: "Acme" },
          { id: "m2", name: "Smart", provider: "Acme" },
        ]}
        value={null}
        onValueChange={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Model: Select a model" })); // its trigger: "<label>: <value or placeholder>"
    expect(await screen.findByRole("listbox", { name: "Model" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  it("names the Team picker's list 'Teams' (the e2e's failing case: a team picked, the popup closing)", async () => {
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/teams": () => ({ items: [{ team: { slug: "registrar", name: "Registrar" } }], nextCursor: null }),
    });
    renderBare(
      <Field label="Team">
        <TeamPicker value="" onChange={() => {}} />
      </Field>,
    );
    await userEvent.click(await screen.findByRole("combobox", { name: "Team" }, { timeout: scaled(4000) }));
    expect(await screen.findByRole("listbox", { name: "Teams" }, { timeout: scaled(4000) })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });
});
