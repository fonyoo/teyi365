import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArticleViewCount } from "./ArticleViewCount";

describe("ArticleViewCount", () => {
  it("renders a visible count with a decorative eye icon", () => {
    const html = renderToStaticMarkup(<ArticleViewCount count={128} />);

    expect(html).toContain('class="article-view-count"');
    expect(html).toContain('title="128 次浏览"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("128 次浏览");
  });

  it.each([
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [-3, 0],
    [12.9, 12]
  ])("normalizes %s to %s views", (count, expected) => {
    const html = renderToStaticMarkup(<ArticleViewCount count={count} />);

    expect(html).toContain(`title="${expected} 次浏览"`);
    expect(html).toContain(`${expected} 次浏览`);
  });
});
