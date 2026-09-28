/* Repeated-boilerplate suppression on the source Overview (ADR-0021). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { boilerplateHeadline, boilerplateRule } from "../pages/sources/boilerplate";
import { SourceDetail } from "../pages/sources/detail";
import { boilerplate, mockApi, renderWith, webRoutes, webSource } from "./web-harness";

afterEach(() => vi.unstubAllGlobals());

beforeAll(() => {
  window.scrollTo = () => {};
});

const found = boilerplate({ repeatedBlocks: 12, pagesAffected: 147, documentsCounted: 200, threshold: 40 });

describe("boilerplate helpers", () => {
  it("summarises what is removed", () => {
    expect(boilerplateHeadline(webSource({ boilerplate: found }))).toBe("12 repeated blocks removed from 147 pages");
    expect(boilerplateHeadline(webSource({ boilerplate: boilerplate({ repeatedBlocks: 1, pagesAffected: 1 }) }))).toBe("1 repeated block removed from 1 page");
    expect(boilerplateHeadline(webSource({ type: "upload", web: null, boilerplate: found }))).toBe("12 repeated blocks removed from 147 documents");
    expect(boilerplateHeadline(webSource({ boilerplate: boilerplate({ pending: true }) }))).toBe("Checking for repeated blocks…");
    expect(boilerplateHeadline(webSource({ boilerplate: boilerplate() }))).toBe("No repeated blocks found.");
    expect(boilerplateHeadline(webSource({ boilerplate: boilerplate({ enabled: false }) }))).toBe("Off: repeated blocks are kept.");
    expect(boilerplateRule(webSource({ boilerplate: found }))).toBe("Blocks in at least 40 of 200 pages (5 or 20%, whichever is more); one copy is kept.");
    expect(boilerplateRule(webSource({ boilerplate: boilerplate() }))).toMatch(/at least 5 or 20%/);
  });
});

describe("Repeated blocks card", () => {
  it("shows the count and lists the most repeated blocks on request", async () => {
    const calls = mockApi({
      ...webRoutes(webSource({ boilerplate: found })),
      "GET /v1/teams/registrar/sources/s1/boilerplate": () => [
        { text: "Ready to see what your agents are actually doing? Start free Talk to us Explore o", documents: 147 },
        { text: "QUICKLINKS", documents: 29 },
      ],
    });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    const card = (await screen.findByRole("heading", { name: "Repeated blocks" })).closest("section")!;
    expect(within(card).getByText("12 repeated blocks removed from 147 pages")).toBeInTheDocument();
    // The list loads only when the disclosure opens.
    expect(calls.some((c) => c.url.endsWith("/boilerplate"))).toBe(false);
    await userEvent.click(within(card).getByRole("button", { name: "Show the most repeated blocks" }));
    const list = await within(card).findByRole("list", { name: "Most repeated blocks" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText(/Ready to see what your agents.*…$/)).toBeInTheDocument();
    expect(within(list).getByText("147 pages")).toBeInTheDocument();
    expect(within(list).getByText("QUICKLINKS")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("lets editors turn it off, keeping the other overrides", async () => {
    let src = webSource({ boilerplate: { ...found, overrides: { minDocs: 5 } } });
    const calls = mockApi({
      ...webRoutes(src),
      "GET /v1/teams/registrar/sources/s1": () => src,
      "PATCH /v1/teams/registrar/sources/s1": () => {
        src = { ...src, revision: 6, boilerplate: { ...found, enabled: false, pending: true, overrides: { minDocs: 5, enabled: false } } };
        return src;
      },
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    const toggle = await screen.findByRole("switch", { name: /Remove repeated blocks/ });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ boilerplate: { minDocs: 5, enabled: false } }));
    expect(calls.find((c) => c.method === "PATCH")?.headers.get("If-Match")).toBe('"5"');
    expect(await screen.findByText("Turning off: repeated blocks are being restored.")).toBeInTheDocument();
  });

  it("is read-only for members, and hidden when off with nothing removed", async () => {
    mockApi(webRoutes(webSource({ boilerplate: found })));
    const { unmount } = renderWith(<SourceDetail sourceId="s1" />, { role: "member" });
    expect(await screen.findByText("12 repeated blocks removed from 147 pages")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Remove repeated blocks/ })).not.toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    mockApi(webRoutes(webSource({ boilerplate: boilerplate({ enabled: false }) })));
    renderWith(<SourceDetail sourceId="s1" />, { role: "member" });
    await screen.findByRole("region", { name: "Document counts" });
    expect(screen.queryByRole("heading", { name: "Repeated blocks" })).not.toBeInTheDocument();
  });
});
