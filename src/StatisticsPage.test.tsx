// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatisticsPage, StatisticsResultsTable } from "./StatisticsPage";
import type { ArticleViewRecord } from "./types";

const { listArticleViewStatistics } = vi.hoisted(() => ({
  listArticleViewStatistics: vi.fn()
}));

vi.mock("./api", () => ({ listArticleViewStatistics }));

const record: ArticleViewRecord = {
  id: 1,
  articleSlug: "post-1",
  articleTitle: "测试文章",
  ipAddress: "203.0.113.8",
  userAgent: "Mozilla/5.0 test-agent",
  deviceType: "desktop",
  osName: "Windows 10",
  browserName: "Chrome 126",
  viewedAt: "2026-07-22 08:00:00"
};

function result(records: ArticleViewRecord[], overrides: Partial<{
  articles: Array<{ slug: string; title: string }>;
  page: number;
  total: number;
  hasMore: boolean;
}> = {}) {
  return {
    records,
    articles: overrides.articles ?? [],
    page: overrides.page ?? 1,
    limit: 20,
    total: overrides.total ?? records.length,
    hasMore: overrides.hasMore ?? false
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  listArticleViewStatistics.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StatisticsPage request lifecycle", () => {
  it("keeps the newer query result when an older request resolves later", async () => {
    const initial = deferred<ReturnType<typeof result>>();
    const older = deferred<ReturnType<typeof result>>();
    const newer = deferred<ReturnType<typeof result>>();
    listArticleViewStatistics.mockReturnValueOnce(initial.promise).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const { container } = render(<StatisticsPage />);
    initial.resolve(result([]));
    await waitFor(() => expect(screen.getByText("没有匹配的访问记录")).toBeTruthy());

    const ipInput = screen.getByLabelText("IP");
    fireEvent.change(ipInput, { target: { value: "old" } });
    fireEvent.submit(container.querySelector("form")!);
    fireEvent.change(ipInput, { target: { value: "new" } });
    fireEvent.submit(container.querySelector("form")!);

    newer.resolve(result([{ ...record, id: 2, articleTitle: "新文章" }], { total: 7 }));
    await waitFor(() => expect(screen.getByText("新文章")).toBeTruthy());
    older.resolve(result([{ ...record, articleTitle: "旧文章" }], { total: 3 }));

    await waitFor(() => expect(screen.getByText("新文章")).toBeTruthy());
    expect(screen.queryByText("旧文章")).toBeNull();
    expect(screen.getByText("共 7 条访问记录")).toBeTruthy();
  });

  it("repeats the same page-one submit and resets an empty result", async () => {
    const initial = deferred<ReturnType<typeof result>>();
    const firstQuery = deferred<ReturnType<typeof result>>();
    const repeatedQuery = deferred<ReturnType<typeof result>>();
    const resetQuery = deferred<ReturnType<typeof result>>();
    listArticleViewStatistics
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(firstQuery.promise)
      .mockReturnValueOnce(repeatedQuery.promise)
      .mockReturnValueOnce(resetQuery.promise);

    const { container } = render(<StatisticsPage />);
    initial.resolve(result([]));
    await waitFor(() => expect(screen.getByText("没有匹配的访问记录")).toBeTruthy());

    const ipInput = screen.getByLabelText("IP");
    fireEvent.change(ipInput, { target: { value: "203.0.113" } });
    fireEvent.submit(container.querySelector("form")!);
    firstQuery.resolve(result([]));
    await waitFor(() => expect(listArticleViewStatistics).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("没有匹配的访问记录")).toBeTruthy());

    fireEvent.submit(container.querySelector("form")!);
    repeatedQuery.resolve(result([]));
    await waitFor(() => expect(listArticleViewStatistics).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByText("没有匹配的访问记录")).toBeTruthy());
    const filtered = { article: "", ip: "203.0.113", device: "", from: "", to: "" };
    expect(listArticleViewStatistics.mock.calls[1]).toEqual([filtered, 1]);
    expect(listArticleViewStatistics.mock.calls[2]).toEqual([filtered, 1]);
    expect(listArticleViewStatistics.mock.calls[1][0]).not.toBe(listArticleViewStatistics.mock.calls[2][0]);

    fireEvent.click(screen.getByRole("button", { name: "重置查询" }));
    resetQuery.resolve(result([]));
    await waitFor(() => expect(listArticleViewStatistics).toHaveBeenCalledTimes(4));
    expect(listArticleViewStatistics.mock.calls[3]).toEqual([{ article: "", ip: "", device: "", from: "", to: "" }, 1]);
  });

  it("clears old rows during a loading query and recovers after an error", async () => {
    const initial = deferred<ReturnType<typeof result>>();
    const failed = deferred<ReturnType<typeof result>>();
    const recovered = deferred<ReturnType<typeof result>>();
    listArticleViewStatistics.mockReturnValueOnce(initial.promise).mockReturnValueOnce(failed.promise).mockReturnValueOnce(recovered.promise);

    const { container } = render(<StatisticsPage />);
    initial.resolve(result([record]));
    await waitFor(() => expect(screen.getByText("测试文章")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("IP"), { target: { value: "203" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.queryByText("测试文章")).toBeNull();
    failed.reject(new Error("查询失败"));
    await waitFor(() => expect(screen.getByText("查询失败")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("IP"), { target: { value: "204" } });
    fireEvent.submit(container.querySelector("form")!);
    recovered.resolve(result([{ ...record, id: 3, articleTitle: "恢复文章" }]));
    await waitFor(() => expect(screen.getByText("恢复文章")).toBeTruthy());
    expect(screen.queryByText("查询失败")).toBeNull();
  });

  it("loads page two and disables the next control at the end", async () => {
    const initial = deferred<ReturnType<typeof result>>();
    const nextPage = deferred<ReturnType<typeof result>>();
    listArticleViewStatistics.mockReturnValueOnce(initial.promise).mockReturnValueOnce(nextPage.promise);

    render(<StatisticsPage />);
    initial.resolve(result([record], { total: 2, hasMore: true }));
    await waitFor(() => expect(screen.getByText("第 1 页")).toBeTruthy());
    expect(screen.getByRole("button", { name: "上一页" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "下一页" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(listArticleViewStatistics).toHaveBeenLastCalledWith(
      { article: "", ip: "", device: "", from: "", to: "" },
      2
    );
    nextPage.resolve(result([{ ...record, id: 2 }], { page: 2, total: 2, hasMore: false }));
    await waitFor(() => expect(screen.getByText("第 2 页")).toBeTruthy());
    expect(screen.getByRole("button", { name: "上一页" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "下一页" })).toHaveProperty("disabled", true);
  });

  it("limits query inputs, constrains date ranges, and connects expanded User-Agent content", async () => {
    const initial = deferred<ReturnType<typeof result>>();
    listArticleViewStatistics.mockReturnValueOnce(initial.promise);
    const { container } = render(<StatisticsPage />);
    initial.resolve(result([]));
    await waitFor(() => expect(screen.getByText("没有匹配的访问记录")).toBeTruthy());

    expect(screen.getByLabelText("IP").getAttribute("maxLength")).toBe("120");
    expect(screen.getByLabelText("设备 / 系统 / 浏览器").getAttribute("maxLength")).toBe("200");

    const from = screen.getByLabelText("开始日期");
    const to = screen.getByLabelText("结束日期");
    fireEvent.change(from, { target: { value: "2026-07-01" } });
    expect(to.getAttribute("min")).toBe("2026-07-01");
    fireEvent.change(to, { target: { value: "2026-07-22" } });
    expect(from.getAttribute("max")).toBe("2026-07-22");
    fireEvent.change(from, { target: { value: "" } });
    expect(to.getAttribute("min")).toBeNull();
    fireEvent.change(to, { target: { value: "" } });
    expect(from.getAttribute("max")).toBeNull();

    const tableHtml = renderToStaticMarkup(
      <StatisticsResultsTable records={[record]} expandedIds={new Set([record.id])} onToggle={() => undefined} />
    );
    expect(tableHtml).toContain('aria-controls="statistics-user-agent-1"');
    expect(tableHtml).toContain('id="statistics-user-agent-1"');
    expect(container.querySelector("form")).toBeTruthy();
  });
});

describe("StatisticsResultsTable", () => {
  it("renders the article, IP, parsed device details, and expandable User-Agent control", () => {
    const html = renderToStaticMarkup(
      <StatisticsResultsTable records={[record]} expandedIds={new Set()} onToggle={() => undefined} />
    );

    expect(html).toContain("测试文章");
    expect(html).toContain("203.0.113.8");
    expect(html).toContain("桌面设备");
    expect(html).toContain("Windows 10");
    expect(html).toContain("Chrome 126");
    expect(html).toContain('aria-label="展开 User-Agent"');
    expect(html).toContain('title="展开 User-Agent"');
    expect(html).not.toContain("aria-controls");
  });

  it("renders the full User-Agent and collapse control for an expanded record", () => {
    const html = renderToStaticMarkup(
      <StatisticsResultsTable records={[record]} expandedIds={new Set([record.id])} onToggle={() => undefined} />
    );

    expect(html).toContain('class="statistics-expanded-agent"');
    expect(html).toContain('colSpan="7"');
    expect(html).toContain(record.userAgent);
    expect(html).toContain('aria-label="收起 User-Agent"');
    expect(html).toContain('title="收起 User-Agent"');
    expect(html).toContain('aria-controls="statistics-user-agent-1"');
    expect(html).toContain('id="statistics-user-agent-1"');
  });

  it("keeps an empty record set inside a semantic table body", () => {
    const html = renderToStaticMarkup(
      <StatisticsResultsTable records={[]} expandedIds={new Set()} onToggle={() => undefined} />
    );

    expect(html).toContain("<table");
    expect(html).toContain("<tbody></tbody>");
  });
});
