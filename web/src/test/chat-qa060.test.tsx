/* Chat polish from the v0.6.0 QA pass (#124-#127): the composer's counter, the retrieval header, bidi isolation, the conversation list. */
import { fireEvent, screen } from "@testing-library/react";
import { mockApi, renderApp, shellRoutes } from "./harness";

const card = {
  id: "ag1",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  slug: "registrar-assistant",
  name: "Registrar assistant",
  description: "Registration and records.",
  accentColor: "#0021a5",
  welcomeMessage: "Hi! Ask me about registration.",
  starterQuestions: [],
  citationMode: "snippet_link",
  status: "active",
};
const chatPath = "/a/registrar/registrar-assistant";
const routes = (extra: Record<string, Parameters<typeof mockApi>[0][string]> = {}) => ({
  ...shellRoutes(),
  "GET /v1/agents/registrar/registrar-assistant": () => card,
  "GET /v1/agents": () => [card],
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

describe("composer length (#127)", () => {
  it("counts characters like the server, not UTF-16 units: 5000 emoji fit in 8000", async () => {
    mockApi(routes());
    renderApp(chatPath);
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    fireEvent.change(box, { target: { value: "😀".repeat(5000) } });
    expect(await screen.findByText("5,000 / 8,000")).toBeInTheDocument();
    expect(box).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: /send|submit/i })).toBeEnabled();
    // 8000 characters are still allowed, 8001 are not.
    fireEvent.change(box, { target: { value: "😀".repeat(8000) } });
    expect(screen.getByRole("button", { name: /send|submit/i })).toBeEnabled();
    fireEvent.change(box, { target: { value: "a".repeat(8001) } });
    expect(await screen.findByText("8,001 / 8,000 (too long)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send|submit/i })).toBeDisabled();
  });
});
