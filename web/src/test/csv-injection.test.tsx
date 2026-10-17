/* #142: the log exports neutralise spreadsheet formulas (a text cell that starts with = + - @ TAB or CR gets a leading quote). */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { csvField, toCSV } from "../pages/admin/logs/common";
import { mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

/** Reads a Blob the way jsdom allows. */
const readBlob = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });

/** Splits CSV text into rows of cells (RFC 4180: quoted fields, doubled quotes). */
function parse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") (row.push(cell), (cell = ""));
    else if (c === "\r" && text[i + 1] === "\n") (row.push(cell), rows.push(row), (row = []), (cell = ""), i++);
    else cell += c;
  }
  return rows;
}

describe("csvField", () => {
  it.each(["=", "+", "-", "@", "\t", "\r"])("prefixes a text cell that starts with %j with a single quote", (ch) => {
    const out = csvField(`${ch}SUM(A1)`);
    // A CR or a quote makes the field need RFC 4180 quoting too: undo that to see the cell.
    const cell = out.startsWith('"') ? out.slice(1, -1).replace(/""/g, '"') : out;
    expect(cell).toBe(`'${ch}SUM(A1)`);
  });

  it("keeps RFC 4180 quoting around the prefixed cell", () => {
    expect(csvField('=HYPERLINK("http://evil.example/","click")')).toBe(`"'=HYPERLINK(""http://evil.example/"",""click"")"`);
    expect(csvField("\r=1")).toBe(`"'\r=1"`);
  });

  it("leaves a value that only contains the characters later, and ordinary text, alone", () => {
    for (const v of ["a=b", "x+y", "a-b", "me@example.edu", "a\tb", "", "plain", " =1"]) expect(csvField(v)).toBe(v);
  });

  it("keeps numbers as numbers: a negative number is not prefixed, only text is", () => {
    expect(csvField(-5)).toBe("-5");
    expect(csvField(-0.5)).toBe("-0.5");
    expect(csvField(7)).toBe("7");
    expect(csvField("-5")).toBe("'-5");
    expect(toCSV(["n"], [[-5]])).toBe("n\r\n-5\r\n");
  });

  it("writes null, undefined, booleans and objects as before", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField(false)).toBe("false");
    expect(csvField({ a: "=1" })).toBe('"{""a"":""=1""}"');
    expect(csvField([1, 2])).toBe('"[1,2]"');
  });
});

describe("the log exports", () => {
  /** Clicks Export CSV and returns the rows of the file it downloads. */
  async function exported(): Promise<string[][]> {
    let blob: Blob | undefined;
    URL.createObjectURL = (b: Blob | MediaSource) => ((blob = b as Blob), "blob:x");
    URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await userEvent.click(await screen.findByRole("button", { name: /Export CSV/ }, { timeout: scaled(4000) }));
    await waitFor(() => expect(blob).toBeDefined());
    return parse(await readBlob(blob!));
  }
  const evil = (label: string) => `=HYPERLINK("http://evil.example/","${label}")`;
  const users = { items: [], nextCursor: null };

  it("neutralises every text column of the audit log export", async () => {
    mockApi({
      ...shellRoutes("platform_auditor"),
      "GET /v1/admin/users": () => users,
      "GET /v1/admin/audit": () => ({
        items: [
          {
            id: 1,
            occurredAt: "2026-09-26T10:00:00Z",
            actorKind: "user",
            actor: { kind: "user", userId: "u2", email: "@alex@example.edu", displayName: "+Alex" },
            actorUserId: "u2",
            teamId: "-t1",
            action: "=team.update",
            targetType: "@team",
            targetId: "\tid",
            targetLabel: evil("label"),
            targetExists: true,
            parent: null,
            before: { name: "=before" },
            after: { name: evil("after") },
            metadata: { name: "=x" },
            requestId: "-req",
            via: { kind: "oauth", name: "=App" },
            clientIp: "-1.2.3.4",
          },
        ],
        nextCursor: null,
      }),
    });
    renderApp("/admin/logs");
    const rows = await exported();
    expect(rows).toHaveLength(2);
    const [header, data] = rows as [string[], string[]];
    expect(data).toHaveLength(header.length);
    const cell = (name: string) => data[header.indexOf(name)];
    expect(cell("actor")).toBe("'+Alex");
    expect(cell("actorEmail")).toBe("'@alex@example.edu");
    expect(cell("action")).toBe("'=team.update");
    expect(cell("targetType")).toBe("'@team");
    expect(cell("targetId")).toBe("'\tid");
    expect(cell("target")).toBe(`'${evil("label")}`);
    expect(cell("teamId")).toBe("'-t1");
    expect(cell("requestId")).toBe("'-req");
    // before and after are written as JSON, which starts with { and cannot be read as a formula.
    expect(cell("before")).toBe('{"name":"=before"}');
    expect(cell("after")).toBe(JSON.stringify({ name: evil("after") }));
    expect(cell("metadata")).toBe('{"name":"=x"}');
    expect(cell("viaName")).toBe("'=App");
    expect(cell("clientIp")).toBe("'-1.2.3.4");
    // The time and the way of acting are not text a person chose, and stay as they are.
    expect(cell("occurredAt")).toBe("2026-09-26T10:00:00Z");
    expect(cell("via")).toBe("oauth");
    expect(data.filter((c) => /^[=+\-@\t\r]/.test(c))).toEqual([]);
  });

  it("neutralises every text column of the access log export", async () => {
    mockApi({
      ...shellRoutes("platform_auditor"),
      "GET /v1/admin/users": () => users,
      "GET /v1/admin/agents": () => [],
      "GET /v1/admin/access-log": () => ({
        items: [
          {
            id: 1,
            at: "2026-09-26T10:00:00Z",
            userId: "u2",
            userEmail: "=blair@example.edu",
            userName: evil("name"),
            apiKeyId: "-key",
            agentId: "ag1",
            agentName: "+Agent",
            agentSlug: "@agent",
            teamSlug: "\tteam",
            agentVersion: -1,
            rank: 1,
            classification: "=sensitive",
            channel: "ui",
          },
        ],
        nextCursor: null,
      }),
    });
    renderApp("/admin/logs?tab=access");
    const rows = await exported();
    expect(rows).toHaveLength(2);
    const [header, data] = rows as [string[], string[]];
    const cell = (name: string) => data[header.indexOf(name)];
    expect(cell("userEmail")).toBe("'=blair@example.edu");
    expect(cell("userName")).toBe(`'${evil("name")}`);
    expect(cell("apiKeyId")).toBe("'-key");
    expect(cell("agent")).toBe("'+Agent");
    expect(cell("agentSlug")).toBe("'@agent");
    expect(cell("team")).toBe("'\tteam");
    expect(cell("classification")).toBe("'=sensitive");
    // The version is a number: it stays one.
    expect(cell("version")).toBe("-1");
    expect(cell("channel")).toBe("ui");
    expect(data.filter((c) => /^[=+@\t\r]/.test(c) || /^-(?!1$)/.test(c))).toEqual([]);
  });
});
