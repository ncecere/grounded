/* Citation markers in answers: which [n] become chips (the same rules as internal/agents/markers.go), axe. */
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Response } from "../components/ui/response/response";

const sources = [1, 2, 3, 4, 5].map((n) => ({ title: `Source ${n}`, href: `https://example.edu/${n}` }));

/** Renders an answer and returns the citation numbers that became chips, in order. */
function chips(text: string): string[] {
  const { unmount } = render(<Response citations={sources}>{text}</Response>);
  const names = screen.queryAllByRole("button", { name: /^Sources? / }).map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
  const out = names.map((n) => n.replace(/^Sources? ([\d, ]+):.*$/, "$1"));
  unmount();
  return out;
}

// The answer (Qwen, arrays and slices in Go) whose `[3]int` was once read as citation 3.
const evidence = [
  "In Go, arrays and slices behave differently [1].",
  "",
  "* Arrays have a fixed length [2]. The size is part of the type (e.g., `[3]int` and `[4]int` are distinct types) [2].",
  "* Arrays are values: assigning one array to another copies all the elements [1][2].",
  "",
  "For C-like behavior with arrays, you can pass a pointer to the array, but using slices is considered more idiomatic [5].",
  "",
  "Citations: [1], [2], [5]",
].join("\n");

describe("citation markers", () => {
  it.each([
    ["inline code", "Use `[3]int` or ``a `[4]` b``, not a slice [1].", ["1"]],
    ["fenced code", "Declare it:\n\n```go\nvar a [3]int // [2]\n```\n\nDone [1].", ["1"]],
    ["indented code", "Example:\n\n    arr [2] = 1\n\nDone [1].", ["1"]],
    ["Markdown link", "See [1](https://example.edu/fees) and the fee [2].", ["2"]],
    ["footnote-like", "A claim[^1] and another [1].", ["1"]],
    ["array index", "Set a[3] = 1 and arr_2[4] too [1].", ["1"]],
    ["two-dimensional index", "Both m[i][2] and a[1][2] work [3].", ["3"]],
    ["type after the brackets", "Declare [3]int arrays [1].", ["1"]],
    ["adjacent markers", "Fees apply [1][2].", ["1", "2"]],
    ["group", "Fees apply [1, 2].", ["1, 2"]],
    ["line ends and punctuation", "Fees apply.[1]\nMore text (see below)[2]\n**Bold**[3]", ["1", "2", "3"]],
    ["unknown numbers stay text", "Nine [9] is not a source [1].", ["1"]],
  ])("%s", (_name, text, want) => {
    expect(chips(text)).toEqual(want);
  });

  it("renders the evidence answer with its code intact and is accessible", async () => {
    const { container } = render(<Response citations={sources}>{evidence}</Response>);
    const code = [...container.querySelectorAll("code")].map((c) => c.textContent);
    expect(code).toEqual(["[3]int", "[4]int"]);
    const names = screen.getAllByRole("button", { name: /^Sources? / }).map((b) => b.getAttribute("aria-label"));
    expect(names.every((n) => !/^Sources? 3\b/.test(n ?? "") && !/^Sources? 4\b/.test(n ?? ""))).toBe(true);
    expect(names).toHaveLength(9); // [1] [2] [2] [1][2] [5] and the list's [1] [2] [5]
    expect(await axe(container)).toHaveNoViolations();
  });
});
