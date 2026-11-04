import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { AssistantAbout } from "../components/assistant-about";
import { Reply, mockApi, renderApp, shellRoutes } from "./harness";

const about = { modelLabel: "Configured chat model", audience: "public" as const, strictlyGrounded: true, ownershipNote: "Owned by the help team", sourceCount: 2, sourcesLimited: false, passageJudging: "enabled" as const, claimChecks: "unknown" as const, moderation: "enabled" as const, retention: "Retention is configured; holds can extend it." };

it("opens with the keyboard, shows honest checks and restores focus on Escape", async () => {
  const user = userEvent.setup();
  render(<AssistantAbout about={about} />);
  await user.tab();
  const trigger = screen.getByRole("button", { name: "About this assistant" });
  expect(trigger).toHaveFocus();
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog", { name: "About this assistant" });
  expect(screen.getByText(/not that every response passed/)).toBeInTheDocument();
  expect(screen.getByText("Owned by the help team")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Platform accessibility statement/ })).toHaveAttribute("href", "/accessibility");
  expect(await axe(dialog)).toHaveNoViolations();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("omits the action when facts are unavailable", () => {
  render(<AssistantAbout />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("serves an honest statement outside the signed-in gate", async () => {
  mockApi({ ...shellRoutes(), "GET /v1/me": () => Reply.error(401, "unauthorized"), "GET /v1/accessibility": () => ({ contactUrl: "mailto:help@example.edu", institutionUrl: "https://example.edu/accessibility", revision: 1 }) });
  const { container } = renderApp("/accessibility");
  expect(await screen.findByRole("heading", { name: "Accessibility statement" })).toBeInTheDocument();
  expect(screen.getByText(/not a certification/)).toBeInTheDocument();
  expect(screen.getByText(/not yet had an independent screen-reader audit/)).toBeInTheDocument();
  expect(await axe(container)).toHaveNoViolations();
});

it("lets only platform admins edit the statement links with a revision precondition", async () => {
 const user = userEvent.setup();
 const calls = mockApi({ ...shellRoutes("platform_admin"), "GET /v1/accessibility": () => ({ contactUrl: "", institutionUrl: "", revision: 1 }), "PUT /v1/admin/settings/accessibility": (body) => ({ ...(body as object), revision: 2 }) });
 renderApp("/accessibility");
 const field = await screen.findByRole("textbox", { name: "Reporting contact URL" });
 await user.type(field, "mailto:help@example.edu");
 await user.click(screen.getByRole("button", { name: "Save statement links" }));
 await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.headers.get("If-Match")).toBe('"1"'));
 expect(await screen.findByRole("link", { name: "Contact the platform support team" })).toHaveAttribute("href", "mailto:help@example.edu");
 expect(await axe(document.body)).toHaveNoViolations();
});

it("does not describe a router as an answer-generating model", async () => {
 const user = userEvent.setup();
 render(<AssistantAbout about={{ ...about, router: true, modelLabel: "Router — delegates answers" }} />);
 await user.click(screen.getByRole("button", { name: "About this assistant" }));
 expect(await screen.findByText(/destination model, sources and checks may differ/)).toBeInTheDocument();
 expect(screen.queryByText(/Configured to answer from its sources/)).toBeNull();
});
