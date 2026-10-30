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
    expect(boilerplateRule(webSource({ boilerplate: found }))).toBe("Blocks in at least 40 of 200 pages (5 pages or 20%, whichever is more); one copy is kept.");
    expect(boilerplateRule(webSource({ boilerplate: boilerplate() }))).toBe("Blocks repeated in at least 5 pages or 20% of them, whichever is more; one copy is kept.");
    // Found but removed nowhere: the pages have no other text (VI-11).
    const kept = boilerplate({ repeatedBlocks: 1, pagesAffected: 0, documentsCounted: 97, threshold: 20 });
    expect(boilerplateHeadline(webSource({ boilerplate: kept }))).toBe("1 repeated block found, kept: it's the only text on the pages that have it.");
    expect(boilerplateHeadline(webSource({ boilerplate: { ...kept, pending: true } }))).toBe("1 repeated block found; removing it…");
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

  it("lets editors opt in to near-duplicate matching, keeping the other overrides (#23)", async () => {
    let src = webSource({ boilerplate: { ...found, overrides: { minDocs: 5 } } });
    const calls = mockApi({
      ...webRoutes(src),
      "GET /v1/teams/registrar/sources/s1": () => src,
      "PATCH /v1/teams/registrar/sources/s1": () => {
        src = { ...src, revision: 6, boilerplate: { ...found, fuzzy: true, pending: true, overrides: { minDocs: 5, fuzzy: true } } };
        return src;
      },
    });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    const toggle = await screen.findByRole("switch", { name: /Also remove near-duplicate blocks/ });
    expect(toggle).not.toBeChecked();
    expect(toggle).not.toHaveAttribute("aria-disabled", "true");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(toggle);
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ boilerplate: { minDocs: 5, fuzzy: true } }));
    expect(calls.find((c) => c.method === "PATCH")?.headers.get("If-Match")).toBe('"5"');
    await waitFor(() => expect(screen.getByRole("switch", { name: /Also remove near-duplicate blocks/ })).toBeChecked());
    // The other switch is untouched.
    expect(screen.getByRole("switch", { name: /Remove repeated blocks/ })).toBeChecked();
  });

  it("needs removal to be on first, and says so", async () => {
    mockApi(webRoutes(webSource({ boilerplate: boilerplate({ enabled: false }) })));
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    const toggle = await screen.findByRole("switch", { name: /Also remove near-duplicate blocks/ });
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/Turn on “Remove repeated blocks” first\./)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("lists a cluster once, with its variants", async () => {
    mockApi({
      ...webRoutes(webSource({ boilerplate: boilerplate({ ...found, fuzzy: true }) })),
      "GET /v1/teams/registrar/sources/s1/boilerplate": () => [
        { text: "Home Admissions Academics Registrar Student life Contact us", documents: 120, variants: 10 },
        { text: "QUICKLINKS", documents: 29, variants: 1 },
      ],
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    const card = (await screen.findByRole("heading", { name: "Repeated blocks" })).closest("section")!;
    await userEvent.click(within(card).getByRole("button", { name: "Show the most repeated blocks" }));
    const list = await within(card).findByRole("list", { name: "Most repeated blocks" });
    expect(within(list).getByText("120 pages, 10 variants")).toBeInTheDocument();
    expect(within(list).getByText("29 pages")).toBeInTheDocument();
  });

  it("is read-only for members (no switches), and hidden when off with nothing removed", async () => {
    mockApi(webRoutes(webSource({ boilerplate: found })));
    const { unmount } = renderWith(<SourceDetail sourceId="s1" />, { role: "member" });
    expect(await screen.findByText("12 repeated blocks removed from 147 pages")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Remove repeated blocks/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /near-duplicate/ })).not.toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    mockApi(webRoutes(webSource({ boilerplate: boilerplate({ enabled: false }) })));
    renderWith(<SourceDetail sourceId="s1" />, { role: "member" });
    await screen.findByRole("region", { name: "Document counts" });
    expect(screen.queryByRole("heading", { name: "Repeated blocks" })).not.toBeInTheDocument();
  });
});
