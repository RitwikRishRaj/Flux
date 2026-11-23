import { describe, expect, it } from "vitest";
import { tokens, typing } from "./code-demo";

describe("tokens", () => {
  it("keeps every character and tags the parts", () => {
    const css = "#blob {\n  background: #F0A27F;\n  width: 90px;\n}";
    const out = tokens(css, "css");
    expect(out.map((t) => t.t).join("")).toBe(css);
    expect(out.filter((t) => t.c === "k").map((t) => t.t.trim())).toEqual(["#blob"]);
    expect(out.filter((t) => t.c === "f").map((t) => t.t)).toEqual(["background", "width"]);
    expect(out.filter((t) => t.c === "s").map((t) => t.t)).toEqual(["#F0A27F", "90px"]);
    const html = '<button id="pat">Pat</button>';
    expect(tokens(html, "html").map((t) => t.t).join("")).toBe(html);
    expect(tokens('let n = 0; s = "hi";', "js").filter((t) => t.c).map((t) => t.t)).toEqual(["let", "0", '"hi"']);
  });
});

describe("typing", () => {
  const values = ["ab", "xyz"];
  it("types, holds, deletes, then moves to the next value", () => {
    const seen = Array.from({ length: 54 }, (_, i) => typing(i, values).typed); // one full loop
    expect(seen.slice(0, 3)).toEqual(["a", "ab", "ab"]);
    expect(seen).toContain("xy");
    expect(seen.indexOf("")).toBeGreaterThan(seen.lastIndexOf("ab")); // deleted before the pause
    expect(seen.indexOf("xyz")).toBeGreaterThan(seen.indexOf(""));
  });
  it("the preview only ever sees whole values", () => {
    for (let i = 0; i < 200; i++) expect(values).toContain(typing(i, values).done);
    expect(typing(0, values).done).toBe("xyz"); // mid-typing "ab": still the previous whole value
  });
});
