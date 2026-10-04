/* The public page's Sign in comes back to the agent (v0.4.2 US-06): ?next= on the sign-in page, same-site paths only. */
import { nextPath } from "../session";

describe("sign-in ?next=", () => {
  it("keeps a same-site path and refuses anything else", () => {
    expect(nextPath("?next=%2Fa%2Flibrary%2Flibrary-guide")).toBe("/a/library/library-guide");
    expect(nextPath("?next=%2Fa%2Fx%3Fc%3D1")).toBe("/a/x?c=1");
    expect(nextPath("")).toBeUndefined();
    expect(nextPath("?next=https%3A%2F%2Fevil.example")).toBeUndefined();
    expect(nextPath("?next=%2F%2Fevil.example")).toBeUndefined();
    expect(nextPath("?next=%2F%5Cevil.example")).toBeUndefined();
  });
});
