/*
 * Small page-level parts of the v0.4.2 shell fixes (M5): settings tables that
 * stack on a phone (VI-17, VI-31), accessible names that say what they're
 * for (AD-22), a clamped description's tooltip (VI-15) and the Add
 * connection form's field widths (VI-36).
 */
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { FormPage } from "../components/templates/form-page";
import { fitCrumbs } from "../components/layout/breadcrumbs";
import { useFormState } from "../lib/use-form-state";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const connection = {
  id: "c1",
  name: "Campus gateway",
  description: "",
  baseUrl: "https://ai.example.edu/v1",
  hasApiKey: true,
  apiKeyHint: "abcd",
  timeoutSeconds: 60,
  requestsPerMinute: null,
  maxConcurrentRequests: 8,
  enabled: true,
  modelCount: 2,
  revision: 1,
  createdAt: "",
  updatedAt: "",
};

describe("settings tables on a phone (VI-17, VI-31)", () => {
  it("notification settings stack, each value named by its column", async () => {
    mockApi({
      ...shellRoutes(),
      "GET /v1/notifications": () => ({ items: [], nextCursor: null, unreadCount: 0 }),
      "GET /v1/me/notification-settings": () => ({
        emailEnabled: true,
        items: [{ type: "team.invited", label: "Invited to a team", description: "Someone invited you to join a team.", mandatory: false, inApp: true, email: true }],
      }),
    });
    const { container } = renderApp("/settings/notifications");
    const table = await screen.findByRole("table", { name: "Notification settings" });
    expect(table).toHaveAttribute("data-stack");
    const cells = await within(table).findAllByRole("cell");
    await waitFor(() => expect(cells[1]).toHaveAttribute("data-label", "In the app"));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("accessible names (AD-22)", () => {
  it("names a connection's model count after the connection", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/connections": () => [connection], "GET /v1/admin/models": () => [] });
    renderApp("/admin/connections");
    const table = await screen.findByRole("table", { name: "Connections" }, { timeout: 4000 });
    expect(await within(table).findByRole("link", { name: "2 models on Campus gateway" })).toHaveAttribute("href", expect.stringContaining("connection=c1"));
  });
});

describe("Add connection (VI-36)", () => {
  it("gives Name the same width as the other endpoint fields", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/connections": () => [connection], "GET /v1/admin/models": () => [] });
    renderApp("/admin/connections?form=new");
    const name = await screen.findByRole("textbox", { name: "Name" }, { timeout: 4000 });
    const base = screen.getByRole("textbox", { name: /Base URL/ });
    expect(name.closest("div[class*='wide']")).not.toBeNull();
    expect(base.closest("div[class*='wide']")).not.toBeNull();
  });
});

describe("agent cards (VI-15)", () => {
  it("give a clamped description its full text on hover", async () => {
    const description = "Answers questions about registration, records, transcripts and graduation, with links to the forms.";
    mockApi({
      ...shellRoutes(),
      "GET /v1/agents": () => [
        { id: "a1", name: "Registrar assistant", description, teamSlug: "registrar", teamName: "Office of the Registrar", agentSlug: "registrar", audience: "team", accentColor: null },
      ],
    });
    renderApp("/agents");
    const text = await screen.findByText(description);
    expect(text).toHaveAttribute("title", description);
  });
});

describe("FormPage after a successful save (US-02, for every form page)", () => {
  function KeyForm({ onClose, fail }: { onClose: () => void; fail?: boolean }) {
    const [form, set, , dirty] = useFormState({ name: "" });
    const save = useMutation({ mutationFn: async () => (fail ? Promise.reject(new Error("No")) : { secret: "s3cret" }) });
    return (
      <FormPage label="Create a key" title="Create a key" onClose={onClose} onSubmit={() => save.mutate()} submitLabel="Create key" busy={save.isPending} dirty={dirty}>
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        {save.isSuccess && <p>Copy the secret now.</p>}
      </FormPage>
    );
  }
  function renderForm(ui: () => React.ReactNode) {
    const root = createRootRoute();
    const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <main>{ui()}</main> });
    const router = createRouter({ routeTree: root.addChildren([home]), history: createMemoryHistory({ initialEntries: ["/"] }) });
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
  }

  it("closes without asking once saved, and asks again after the next edit", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderForm(() => <KeyForm onClose={onClose} />);
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "Main site");
    await user.click(screen.getByRole("button", { name: "Create key" }));
    await screen.findByText("Copy the secret now.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.type(screen.getByRole("textbox", { name: "Name" }), " 2");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("alertdialog", { name: "Leave without saving?" })).toBeInTheDocument();
  });

  it("still asks after a failed save", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderForm(() => <KeyForm onClose={onClose} fail />);
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "Main site");
    await user.click(screen.getByRole("button", { name: "Create key" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("alertdialog", { name: "Leave without saving?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("breadcrumbs (VI-09b)", () => {
  it("never show a crumb without text", () => {
    const fitted = fitCrumbs([{ label: "Demo" }, { label: "Agents" }, { label: "" }, { label: "Version history" }], false);
    expect(fitted.map((c) => c.label)).toEqual(["Demo", "Agents", "Version history"]);
  });
});
