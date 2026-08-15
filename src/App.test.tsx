// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Article, ArticleSummary } from "./types";

const api = vi.hoisted(() => ({
  approveMessage: vi.fn(),
  createArticle: vi.fn(),
  createMessage: vi.fn(),
  deleteArticle: vi.fn(),
  deleteMessage: vi.fn(),
  getArticle: vi.fn(),
  getMessageCaptcha: vi.fn(),
  getMe: vi.fn(),
  listArticles: vi.fn(),
  listMessages: vi.fn(),
  listTags: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  searchArticles: vi.fn(),
  updateArticle: vi.fn(),
  uploadImageFile: vi.fn(),
  ApiRequestError: class ApiRequestError extends Error {
    code: string;

    /** Creates the API error shape consumed by App route error handling. */
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
}));

vi.mock("./api", () => api);
vi.mock("./StatisticsPage", () => ({ StatisticsPage: () => <div data-testid="statistics-page">统计页面</div> }));

const articleSummary: ArticleSummary = {
  id: 1,
  slug: "test-article",
  title: "测试文章",
  excerpt: "测试摘要",
  coverImageUrl: "",
  visibility: "public",
  viewCount: 0,
  createdAt: "2026-07-20 08:00:00",
  updatedAt: "2026-07-22 08:00:00",
  tags: []
};

const openedArticle: Article = {
  ...articleSummary,
  viewCount: 1,
  content: "详情正文"
};

/** Creates a controllable promise for exercising route changes during an article request. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

/** Returns the initial article search payload used by App bootstrap. */
function articleSearchResult() {
  return {
    articleResult: {
      articles: [articleSummary],
      page: 1,
      limit: 10,
      total: 1,
      hasMore: false
    },
    allArticleTotal: 1,
    tags: []
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }
  });
  api.getMe.mockResolvedValue({ authenticated: true });
  api.searchArticles.mockResolvedValue(articleSearchResult());
  api.listMessages.mockResolvedValue({ messages: [] });
  api.getMessageCaptcha.mockResolvedValue({ captcha: null });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("App article routing", () => {
  it("keeps a newer statistics route when an older article request resolves", async () => {
    const pendingArticle = deferred<{ article: Article }>();
    api.getArticle.mockReturnValueOnce(pendingArticle.promise);
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "测试文章" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /测试文章/ }));
    await waitFor(() => expect(api.getArticle).toHaveBeenCalledWith("test-article", ""));

    act(() => {
      window.history.pushState(null, "", "/statistics");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(screen.getByTestId("statistics-page")).toBeTruthy());
    expect(screen.getByRole("button", { name: "统计" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "留言板" })).toHaveProperty("disabled", false);

    await act(async () => {
      pendingArticle.resolve({ article: openedArticle });
      await pendingArticle.promise;
    });

    expect(window.location.pathname).toBe("/statistics");
    expect(screen.getByTestId("statistics-page")).toBeTruthy();
    expect(screen.queryByText("详情正文")).toBeNull();
  });

  it("does not let a stale article cleanup release a newer guestbook action", async () => {
    const pendingArticle = deferred<{ article: Article }>();
    const pendingGuestbook = deferred<{ messages: [] }>();
    api.getArticle.mockReturnValueOnce(pendingArticle.promise);
    api.listMessages.mockReturnValue(pendingGuestbook.promise);
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "测试文章" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /测试文章/ }));
    await waitFor(() => expect(api.getArticle).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /特医 365/ }));
    fireEvent.click(screen.getByRole("button", { name: "留言板" }));
    await waitFor(() => expect(api.listMessages).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "打开中..." })).toHaveProperty("disabled", true);

    await act(async () => {
      pendingArticle.resolve({ article: openedArticle });
      await pendingArticle.promise;
    });

    expect(screen.getByRole("button", { name: "打开中..." })).toHaveProperty("disabled", true);
    await act(async () => {
      pendingGuestbook.resolve({ messages: [] });
      await pendingGuestbook.promise;
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "留言板" })).toHaveProperty("disabled", false));
  });

  it("does not let an older same-article action release a newer invocation", async () => {
    const firstArticle = deferred<{ article: Article }>();
    const secondArticle = deferred<{ article: Article }>();
    api.getArticle.mockReturnValueOnce(firstArticle.promise).mockReturnValueOnce(secondArticle.promise);
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "测试文章" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /测试文章/ }));
    await waitFor(() => expect(api.getArticle).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /特医 365/ }));
    fireEvent.click(screen.getByRole("button", { name: /测试文章/ }));
    await waitFor(() => expect(api.getArticle).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "留言板" })).toHaveProperty("disabled", true);

    await act(async () => {
      firstArticle.resolve({ article: openedArticle });
      await firstArticle.promise;
    });

    expect(screen.getByRole("button", { name: "留言板" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /测试文章/ })).toHaveProperty("disabled", true);
    await act(async () => {
      secondArticle.resolve({ article: openedArticle });
      await secondArticle.promise;
    });
    await waitFor(() => expect(screen.getByText("详情正文")).toBeTruthy());
  });

  it("synchronizes a counted article view back into the existing list", async () => {
    api.getArticle.mockResolvedValueOnce({ article: openedArticle });
    render(<App />);
    await waitFor(() => expect(screen.getByText("0 次浏览")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /测试文章/ }));
    await waitFor(() => expect(screen.getByText("详情正文")).toBeTruthy());
    expect(screen.getByText("1 次浏览")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));

    expect(screen.getByText("1 次浏览")).toBeTruthy();
    expect(api.searchArticles).toHaveBeenCalledTimes(1);
  });

  it("loads the article comment area with the opened article id", async () => {
    api.getArticle.mockResolvedValueOnce({ article: openedArticle });
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "测试文章" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /测试文章/ }));

    await waitFor(() => expect(api.listMessages).toHaveBeenCalledWith(1, ""));
    expect(screen.getByRole("heading", { name: "文章评论" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "发送评论" })).toBeTruthy();
  });
});

describe("App statistics authorization", () => {
  it("keeps an unauthenticated direct route without mounting statistics data", async () => {
    api.getMe.mockResolvedValueOnce({ authenticated: false });
    window.history.replaceState(null, "", "/statistics");
    render(<App />);

    await waitFor(() => expect(screen.getByText("登录后才能查看访问统计。")).toBeTruthy());
    expect(screen.queryByTestId("statistics-page")).toBeNull();
    expect(window.location.pathname).toBe("/statistics");
  });

  it("mounts statistics for an authenticated direct route", async () => {
    window.history.replaceState(null, "", "/statistics");
    render(<App />);

    await waitFor(() => expect(screen.getByTestId("statistics-page")).toBeTruthy());
    expect(document.title).toBe("特医365 - 访问统计");
    expect(window.location.pathname).toBe("/statistics");
  });
});
