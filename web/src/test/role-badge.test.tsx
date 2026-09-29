/* The role badge explains what a team role can and can't do (tasks H9), on the Members list, the Overview's "Your role" and Team settings; with axe. */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { RoleBadge } from "../components/role-badge";
import { roleAbilities, teamRoles } from "../components/roles";
import { renderBare } from "./harness";

describe("the role badge", () => {
  it("opens what an editor can and can't do", async () => {
    const { container } = renderBare(<RoleBadge role="editor" prefix="Your role: " tone="info" />);
    const badge = await screen.findByRole("button", { name: "Your role: Editor: what this role can do" });
    expect(badge).toHaveTextContent("Your role: Editor");
    await userEvent.click(badge);
    const dialog = await screen.findByRole("dialog", { name: "What an editor can do" });
    expect(within(dialog).getByText("Create and edit data sources, knowledge bases, agents and evaluations")).toBeInTheDocument();
    expect(within(dialog).getByText("Manage members or team service keys")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has something to say about every role", () => {
    for (const r of teamRoles) {
      expect(roleAbilities[r].can.length).toBeGreaterThan(0);
      expect(roleAbilities[r].cannot.length).toBeGreaterThan(0);
    }
  });
});
