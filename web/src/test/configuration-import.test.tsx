import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { mockApi, renderApp, Reply, shellRoutes } from "./harness";

// Team settings → Import configuration (docs/specs/config-as-code-import §8).

const page = "/teams/registrar/settings/configuration";
const file = '{"apiVersion":"grounded.team/v1","sources":[],"knowledgeBases":[],"agents":[],"evaluationSets":[],"webhooks":[]}';

const row = (over: Record<string, unknown>) => ({ kind: "source", key: "Handbook", action: "no-op", changes: [], blockers: [], notes: [], ...over });
const plan = (rows: ReturnType<typeof row>[], digest = "digest-1") => ({
  planDigest: digest,
  counts: {
    create: rows.filter((r) => r.action === "create").length,
    update: rows.filter((r) => r.action === "update").length,
    noOp: rows.filter((r) => r.action === "no-op").length,
    notInFile: rows.filter((r) => r.action === "not-in-file").length,
    blocked: rows.filter((r) => r.blockers.length > 0).length,
  },
  rows,
  notes: ["Nothing in the team is deleted or renamed: objects that are not in the file stay as they are."],
});

const changed = plan([
  row({ kind: "knowledgeBase", key: "Student help", action: "update", changes: [{ field: "description", from: '""', to: '"Answers for students"' }] }),
  row({ kind: "webhook", key: "https://hooks.example.com/grounded", action: "create", notes: ["Created turned off, with a new signing secret shown once after applying."] }),
  row({}),
]);

async function paste(text = file) {
  fireEvent.change(await screen.findByRole("textbox", { name: "Configuration (YAML)" }), { target: { value: text } });
}

it("checks a file, shows what changes, and applies it with the plan's digest, showing a new webhook's secret once", async () => {
  const calls = mockApi({
    ...shellRoutes("none", "editor"),
    "POST /v1/teams/registrar/configuration/plan": () => changed,
    "POST /v1/teams/registrar/configuration/apply": () => ({ plan: changed, webhookSecrets: [{ url: "https://hooks.example.com/grounded", secret: "whsec_test" }] }),
  });
  const { container } = renderApp(page);
  expect(await screen.findByRole("heading", { name: "Import configuration" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check changes" })).toBeDisabled();
  expect(calls.some((c) => c.url.includes("/configuration/"))).toBe(false); // nothing is sent on opening the page
  await paste();
  await userEvent.click(screen.getByRole("button", { name: "Check changes" }));
  expect(await screen.findByText("1 to create, 1 to update. Applying makes every change or none.")).toBeInTheDocument();
  expect(screen.getByText("Student help")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /1 unchanged or not in the file/ })).toBeInTheDocument();
  const sent = calls.find((c) => c.url.endsWith("/configuration/plan"))!;
  expect(sent.rawBody).toBe(file);
  expect(sent.headers.get("Content-Type")).toBe("application/yaml");
  expect(await axe(container)).toHaveNoViolations();

  await userEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(await screen.findByText("Applied: 1 created, 1 updated")).toBeInTheDocument();
  expect(calls.find((c) => c.url.endsWith("/configuration/apply"))!.headers.get("If-Match")).toBe('"digest-1"');
  expect(screen.getByText("whsec_test")).toBeInTheDocument();
});

it("keeps Apply off while a row is blocked, and after the file is edited until it is checked again", async () => {
  mockApi({
    ...shellRoutes("none", "owner"),
    "POST /v1/teams/registrar/configuration/plan": () => plan([row({ kind: "agent", key: "helper", action: "update", blockers: ["This install has no chat model \"gpt\" on the connection \"gw\"."] })]),
  });
  renderApp(page);
  await paste();
  await userEvent.click(await screen.findByRole("button", { name: "Check changes" }));
  expect(await screen.findByText(/This install has no chat model/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  await paste(file + "\n");
  expect(await screen.findByText("Check it again before applying.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();
});

it("shows the fresh plan when the team changed since the check (412)", async () => {
  const fresh = plan([row({ kind: "knowledgeBase", key: "Student help", action: "update", changes: [{ field: "topK", from: "5", to: "4" }] })], "digest-2");
  mockApi({
    ...shellRoutes("none", "admin"),
    "POST /v1/teams/registrar/configuration/plan": () => changed,
    "POST /v1/teams/registrar/configuration/apply": () => new Reply(412, { error: { code: "configuration_changed", message: "changed", details: { plan: fresh } } }),
  });
  renderApp(page);
  await paste();
  await userEvent.click(await screen.findByRole("button", { name: "Check changes" }));
  await userEvent.click(await screen.findByRole("button", { name: "Apply changes" }));
  expect(await screen.findByText("The team changed since you checked")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("topK")).toBeInTheDocument());
});

it("tells a member it is for editors, and sends nothing", async () => {
  const calls = mockApi(shellRoutes("none", "member"));
  renderApp(page);
  expect(await screen.findByText(/editors/i)).toBeInTheDocument();
  expect(calls.some((c) => c.url.includes("/configuration"))).toBe(false);
});
