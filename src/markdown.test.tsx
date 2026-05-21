import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./App";

describe("MarkdownRenderer", () => {
  it("renders double equals text as a highlighted mark and preserves kbd tags", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content="这一段 ==重点==，按 <kbd>Ctrl</kbd>。" />);

    expect(html).toContain("<mark>重点</mark>");
    expect(html).toContain("<kbd>Ctrl</kbd>");
    expect(html).not.toContain("==重点==");
  });

  it("keeps allowed inline HTML while stripping unsafe raw HTML", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content={'<kbd class="ignored">A</kbd><script>alert(1)</script>'} />);

    expect(html).toContain("<kbd>A</kbd>");
    expect(html).not.toContain("class=");
    expect(html).not.toContain("<script>");
  });
});
