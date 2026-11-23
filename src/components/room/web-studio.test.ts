import { describe, it, expect } from "vitest";
import { buildSrcDoc, buildPreviewPage } from "./web-studio";

describe("buildSrcDoc", () => {
  it("places html, css and js in the document", () => {
    const out = buildSrcDoc("<p>hi</p>", "p{color:red}", "console.log(1)");
    expect(out).toContain("<style>p{color:red}</style>");
    expect(out).toContain("<body><p>hi</p><script>console.log(1)</script></body>");
  });

  it("stops user code from closing the script or style tag early", () => {
    const out = buildSrcDoc("", "a{}</STYLE><b>", 'const s = "</script><i>";');
    expect(out.match(/<\/script>/gi)).toHaveLength(1);
    expect(out.match(/<\/style>/gi)).toHaveLength(1);
  });

  it("new-tab page keeps user code inside the sandboxed iframe's srcdoc", () => {
    const user = '<p title="x">a & b</p>" onload="alert(1)';
    const page = buildPreviewPage(user);
    const attr = page.match(/<iframe sandbox="allow-scripts allow-modals allow-forms" srcdoc="([^"]*)"><\/iframe>/);
    expect(attr).not.toBeNull();
    // A quote in user code cannot end the attribute and inject one of its own.
    expect(attr![1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")).toBe(user);
  });
});
