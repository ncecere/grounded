/* WCAG 2.5.3, Label in Name: a control's accessible name contains the text it shows (axe 4.14's label-content-name-mismatch).
 * The canvas stub in setup.ts makes the rule run in jsdom, so every page test's axe check covers it; these tests pin
 * that it does, and the components the e2e suite found failing. */
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { FilterBar, type Facet } from "@/components/ui/filter-bar/filter-bar";
import { Source, Sources, SourcesContent } from "@/components/ui/sources/sources";

const rule = { runOnly: ["label-content-name-mismatch"] };

describe("label in name", () => {
  it("is checked in jsdom: a count in the label but not in the text, and a different wording, fail", async () => {
    const { container } = render(
      <div>
        <button type="button" aria-label="Paused, 0">
          Paused<span>0</span>
        </button>
        <a href="https://example.edu/guide" aria-label="How OAuth sign-in works (opens in a new tab)">
          How it works
        </a>
      </div>,
    );
    const result = await axe(container, rule);
    expect(result.violations.map((v) => v.id)).toEqual(["label-content-name-mismatch"]);
    expect(result.violations[0]!.nodes).toHaveLength(2);
  });

  it("passes a name that starts with the visible text", async () => {
    const { container } = render(
      <div>
        <a href="https://example.edu/guide" aria-label="How it works: OAuth sign-in (opens in a new tab)">
          How it works
        </a>
        <button type="button" aria-label="Use it: the built-in default for Agents">
          Use it
        </button>
      </div>,
    );
    expect((await axe(container, rule)).violations).toEqual([]);
  });

  it("names a filter option with its count the way it shows it", async () => {
    const facets: Facet<{ s: string }>[] = [
      { id: "status", label: "Status", type: "toggle", options: [{ value: "paused", label: "Paused" }, { value: "active", label: "Active" }], accessor: (r) => r.s },
    ];
    const { container } = render(<FilterBar facets={facets} counts={{ status: { paused: 0, active: 1234 } }} />);
    expect(screen.getByRole("button", { name: "Paused 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active 1,234" })).toBeInTheDocument();
    expect((await axe(container, rule)).violations).toEqual([]);
  });

  it("names a selectable source by what it shows, after the hidden action", async () => {
    const { container } = render(
      <Sources defaultOpen>
        <SourcesContent>
          <Source index={1} title="Parking handbook" meta="Handbook › Parking" description="Permits are issued yearly." onSelect={() => {}} selectAction="Show" />
        </SourcesContent>
      </Sources>,
    );
    expect(screen.getByRole("button", { name: /^Show Source 1: Parking handbook/ })).toBeInTheDocument();
    expect((await axe(container, rule)).violations).toEqual([]);
  });
});
