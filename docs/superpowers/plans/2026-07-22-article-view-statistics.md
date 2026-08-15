# Article View Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deduplicated article view counts and a desktop-only, administrator-queryable permanent access log containing IP and device information.

**Architecture:** D1 stores a fast aggregate on `articles`, permanent event rows in `article_views`, and one per-visitor/article deduplication row in `article_view_visitors`. A focused Pages Functions module owns visitor parsing, HMAC identity, deduplication writes, and filtered statistics queries; React adds a focused statistics page while the existing app only owns routing and navigation.

**Tech Stack:** React 19, TypeScript, Vite, Cloudflare Pages Functions, Cloudflare D1/SQLite, Vitest, `ua-parser-js`, lucide-react, Playwright.

---

## File Map

- Create `migrations/0007_article_view_statistics.sql`: aggregate column, permanent event table, deduplication table, and indexes.
- Create `functions/api/articleStatistics.ts`: visitor identity parsing, date/filter validation, D1 count recording, and administrator query logic.
- Create `functions/api/articleStatistics.test.ts`: focused helper and query-validation tests.
- Modify `functions/api/[[path]].ts`: route wiring, article `view_count` selection/formatting, and best-effort counting after access checks.
- Modify `functions/api/helpers.test.ts`: public article formatting/count regression coverage where appropriate.
- Modify `src/types.ts`: public view count and administrator statistics contracts.
- Create `src/statistics.ts`: statistics query-string and display helpers.
- Create `src/statistics.test.ts`: query serialization and display helper tests.
- Create `src/StatisticsPage.tsx`: administrator filter form, table, expanded User-Agent rows, and pagination.
- Create `src/StatisticsPage.test.tsx`: server-rendered presentational table tests.
- Create `src/ArticleViewCount.tsx`: shared compact public count display.
- Create `src/ArticleViewCount.test.tsx`: count display markup test.
- Modify `src/api.ts`: authenticated statistics API client.
- Modify `src/App.tsx`: `/statistics` routing, desktop administrator navigation, and count placement.
- Modify `src/styles.css`: statistics form/table, count metadata, loading states, and mobile navigation hiding.
- Modify `README.md`: document the migration, public counts, administrator statistics, and retained visitor data.

## Task 1: Add the D1 Schema and User-Agent Dependency

**Files:**
- Create: `migrations/0007_article_view_statistics.sql`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the parsing dependency**

Run:

```bash
pnpm add ua-parser-js
```

Expected: `ua-parser-js` appears under `dependencies`, the lockfile updates, and installation exits 0.

- [ ] **Step 2: Create the migration**

Create `migrations/0007_article_view_statistics.sql` with:

```sql
ALTER TABLE articles ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE article_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT 'unknown',
  os_name TEXT NOT NULL DEFAULT 'unknown',
  browser_name TEXT NOT NULL DEFAULT 'unknown',
  viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE article_view_visitors (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,
  last_counted_at TEXT NOT NULL,
  PRIMARY KEY (article_id, visitor_hash)
);

CREATE INDEX idx_article_views_article_viewed_at
  ON article_views (article_id, viewed_at DESC);
CREATE INDEX idx_article_views_visitor_article_viewed_at
  ON article_views (visitor_hash, article_id, viewed_at DESC);
CREATE INDEX idx_article_views_ip_viewed_at
  ON article_views (ip_address, viewed_at DESC);
CREATE INDEX idx_article_views_viewed_at
  ON article_views (viewed_at DESC);
```

- [ ] **Step 3: Apply and inspect the local migration**

Run:

```bash
pnpm db:migrate:local
pnpm exec wrangler d1 execute cloudflare_blog --local --command "PRAGMA table_info(articles); SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('article_views', 'article_view_visitors') ORDER BY name;"
```

Expected: migration `0007_article_view_statistics.sql` succeeds, `articles.view_count` is present with default `0`, and both new tables are listed.

- [ ] **Step 4: Commit the schema boundary**

```bash
git add migrations/0007_article_view_statistics.sql package.json pnpm-lock.yaml
git commit -m "feat: add article statistics schema"
```

## Task 2: Build and Test Visitor and Filter Helpers

**Files:**
- Create: `functions/api/articleStatistics.test.ts`
- Create: `functions/api/articleStatistics.ts`

- [ ] **Step 1: Write failing tests for visitor parsing, hashing, LIKE escaping, and dates**

Create `functions/api/articleStatistics.test.ts` with tests equivalent to:

```ts
import { describe, expect, it } from "vitest";
import {
  articleViewVisitorHash,
  escapeStatisticsLike,
  parseArticleViewDevice,
  parseStatisticsFilters
} from "./articleStatistics";

describe("article statistics helpers", () => {
  it("parses desktop, mobile, and unknown user agents", () => {
    expect(
      parseArticleViewDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
      )
    ).toMatchObject({ deviceType: "desktop", osName: expect.stringContaining("Windows"), browserName: expect.stringContaining("Chrome") });
    expect(
      parseArticleViewDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"
      )
    ).toMatchObject({ deviceType: "mobile", osName: expect.stringContaining("iOS"), browserName: expect.stringContaining("Mobile Safari") });
    expect(parseArticleViewDevice("")).toEqual({ deviceType: "unknown", osName: "unknown", browserName: "unknown" });
  });

  it("creates stable visitor hashes without exposing the source values", async () => {
    const first = await articleViewVisitorHash("secret", "203.0.113.8", "browser-a");
    expect(first).toBe(await articleViewVisitorHash("secret", "203.0.113.8", "browser-a"));
    expect(first).not.toContain("203.0.113.8");
    expect(first).not.toBe(await articleViewVisitorHash("secret", "203.0.113.9", "browser-a"));
  });

  it("escapes SQL LIKE wildcard characters", () => {
    expect(escapeStatisticsLike("100%_ok\\done")).toBe("100\\%\\_ok\\\\done");
  });

  it("parses inclusive date filters and rejects invalid ranges", () => {
    expect(parseStatisticsFilters(new URL("https://example.com/api/statistics?from=2026-07-01&to=2026-07-22&page=2"))).toMatchObject({
      from: "2026-07-01 00:00:00",
      toExclusive: "2026-07-23 00:00:00",
      page: 2
    });
    expect(() => parseStatisticsFilters(new URL("https://example.com/api/statistics?from=2026-07-23&to=2026-07-22"))).toThrow("开始日期不能晚于结束日期");
    expect(() => parseStatisticsFilters(new URL("https://example.com/api/statistics?from=2026-02-30"))).toThrow("日期格式不正确");
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm exec vitest run functions/api/articleStatistics.test.ts
```

Expected: FAIL because `functions/api/articleStatistics.ts` does not exist.

- [ ] **Step 3: Implement the minimal helper module**

Create `functions/api/articleStatistics.ts` with these public contracts and behavior:

```ts
import { UAParser } from "ua-parser-js";

export type ArticleViewDeviceType = "desktop" | "mobile" | "tablet" | "unknown";

export interface StatisticsFilters {
  article: string;
  ip: string;
  device: string;
  from: string;
  toExclusive: string;
  page: number;
}

export class StatisticsFilterError extends Error {}

export function parseArticleViewDevice(userAgent: string) {
  if (!userAgent.trim()) {
    return { deviceType: "unknown" as const, osName: "unknown", browserName: "unknown" };
  }
  const result = new UAParser(userAgent).getResult();
  const parsedType = result.device.type;
  const deviceType: ArticleViewDeviceType = parsedType === "mobile" || parsedType === "tablet" ? parsedType : "desktop";
  return {
    deviceType,
    osName: joinAgentName(result.os.name, result.os.version),
    browserName: joinAgentName(result.browser.name, result.browser.version)
  };
}

function joinAgentName(name?: string, version?: string) {
  return [name, version].filter(Boolean).join(" ") || "unknown";
}

export async function articleViewVisitorHash(secret: string, ipAddress: string, userAgent: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`article-view:${ipAddress}\n${userAgent}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function escapeStatisticsLike(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function parseStatisticsFilters(url: URL): StatisticsFilters {
  const article = boundedFilter(url.searchParams.get("article") ?? "", 200);
  const ip = boundedFilter(url.searchParams.get("ip") ?? "", 120);
  const device = boundedFilter(url.searchParams.get("device") ?? "", 200);
  const fromDate = parseDate(url.searchParams.get("from") ?? "");
  const toDate = parseDate(url.searchParams.get("to") ?? "");
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new StatisticsFilterError("开始日期不能晚于结束日期");
  }
  return {
    article,
    ip,
    device,
    from: fromDate ? sqliteDate(fromDate) : "",
    toExclusive: toDate ? sqliteDate(new Date(toDate.getTime() + 86_400_000)) : "",
    page: positivePage(url.searchParams.get("page"))
  };
}

function boundedFilter(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new StatisticsFilterError("查询条件过长");
  return trimmed;
}

function parseDate(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new StatisticsFilterError("日期格式不正确");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new StatisticsFilterError("日期格式不正确");
  }
  return parsed;
}

function sqliteDate(value: Date) {
  return `${value.toISOString().slice(0, 10)} 00:00:00`;
}

function positivePage(value: string | null) {
  const parsed = Number(value ?? 1);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm exec vitest run functions/api/articleStatistics.test.ts
pnpm typecheck:functions
```

Expected: helper tests pass and Functions TypeScript exits 0.

- [ ] **Step 5: Commit the tested helper boundary**

```bash
git add functions/api/articleStatistics.ts functions/api/articleStatistics.test.ts
git commit -m "feat: add article statistics helpers"
```

## Task 3: Record Views and Expose the Administrator API

**Files:**
- Modify: `functions/api/articleStatistics.ts`
- Modify: `functions/api/articleStatistics.test.ts`
- Modify: `functions/api/[[path]].ts`
- Modify: `functions/api/helpers.test.ts`

- [ ] **Step 1: Add failing query-construction and cooldown tests**

Extend `functions/api/articleStatistics.test.ts` to assert:

```ts
import { articleViewCutoff, buildStatisticsWhere } from "./articleStatistics";

it("uses an exact 30 minute cooldown", () => {
  expect(articleViewCutoff(new Date("2026-07-22T12:30:00.000Z"))).toBe("2026-07-22 12:00:00");
});

it("builds parameterized statistics filters", () => {
  expect(buildStatisticsWhere({
    article: "post-1",
    ip: "203.0.113.%",
    device: "Chrome_126",
    from: "2026-07-01 00:00:00",
    toExclusive: "2026-07-23 00:00:00",
    page: 1
  })).toEqual({
    where: "WHERE a.slug = ? AND av.ip_address LIKE ? ESCAPE '\\\\' AND (av.device_type LIKE ? ESCAPE '\\\\' OR av.os_name LIKE ? ESCAPE '\\\\' OR av.browser_name LIKE ? ESCAPE '\\\\' OR av.user_agent LIKE ? ESCAPE '\\\\') AND av.viewed_at >= ? AND av.viewed_at < ?",
    bindings: ["post-1", "%203.0.113.\\%%", "%Chrome\\_126%", "%Chrome\\_126%", "%Chrome\\_126%", "%Chrome\\_126%", "2026-07-01 00:00:00", "2026-07-23 00:00:00"]
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run functions/api/articleStatistics.test.ts
```

Expected: FAIL because `articleViewCutoff` and `buildStatisticsWhere` are missing.

- [ ] **Step 3: Add the D1 record and query functions**

Extend `functions/api/articleStatistics.ts` with:

```ts
const articleViewCooldownSeconds = 30 * 60;
const statisticsPageSize = 20;

export function articleViewCutoff(now: Date) {
  return toSqliteTimestamp(new Date(now.getTime() - articleViewCooldownSeconds * 1000));
}

export function buildStatisticsWhere(filters: StatisticsFilters) {
  const clauses: string[] = [];
  const bindings: string[] = [];
  if (filters.article) {
    clauses.push("a.slug = ?");
    bindings.push(filters.article);
  }
  if (filters.ip) {
    clauses.push("av.ip_address LIKE ? ESCAPE '\\\\'");
    bindings.push(`%${escapeStatisticsLike(filters.ip)}%`);
  }
  if (filters.device) {
    const match = `%${escapeStatisticsLike(filters.device)}%`;
    clauses.push("(av.device_type LIKE ? ESCAPE '\\\\' OR av.os_name LIKE ? ESCAPE '\\\\' OR av.browser_name LIKE ? ESCAPE '\\\\' OR av.user_agent LIKE ? ESCAPE '\\\\')");
    bindings.push(match, match, match, match);
  }
  if (filters.from) {
    clauses.push("av.viewed_at >= ?");
    bindings.push(filters.from);
  }
  if (filters.toExclusive) {
    clauses.push("av.viewed_at < ?");
    bindings.push(filters.toExclusive);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", bindings };
}

export async function recordArticleView(db: D1Database, articleId: number, request: Request, secret: string, now = new Date()) {
  const ipAddress = request.headers.get("CF-Connecting-IP")?.trim()
    || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || "unknown";
  const userAgent = request.headers.get("User-Agent")?.trim() || "";
  const visitorHash = await articleViewVisitorHash(secret, ipAddress, userAgent);
  const countedAt = toSqliteTimestamp(now);
  const claim = await db.prepare(`
    INSERT INTO article_view_visitors (article_id, visitor_hash, last_counted_at)
    VALUES (?, ?, ?)
    ON CONFLICT(article_id, visitor_hash) DO UPDATE SET last_counted_at = excluded.last_counted_at
    WHERE article_view_visitors.last_counted_at <= ?
    RETURNING article_id
  `).bind(articleId, visitorHash, countedAt, articleViewCutoff(now)).first<{ article_id: number }>();
  if (!claim) return false;

  const device = parseArticleViewDevice(userAgent);
  await db.batch([
    db.prepare(`
      INSERT INTO article_views (article_id, ip_address, visitor_hash, user_agent, device_type, os_name, browser_name, viewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(articleId, ipAddress, visitorHash, userAgent, device.deviceType, device.osName, device.browserName, countedAt),
    db.prepare("UPDATE articles SET view_count = view_count + 1 WHERE id = ?").bind(articleId)
  ]);
  return true;
}

export async function listArticleViewStatistics(db: D1Database, filters: StatisticsFilters) {
  const { where, bindings } = buildStatisticsWhere(filters);
  const offset = (filters.page - 1) * statisticsPageSize;
  const [count, records, articles] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM article_views av JOIN articles a ON a.id = av.article_id ${where}`).bind(...bindings).first<{ total: number }>(),
    db.prepare(`
      SELECT av.id, a.slug, a.title, av.ip_address, av.user_agent, av.device_type, av.os_name, av.browser_name, av.viewed_at
      FROM article_views av
      JOIN articles a ON a.id = av.article_id
      ${where}
      ORDER BY datetime(av.viewed_at) DESC, av.id DESC
      LIMIT ? OFFSET ?
    `).bind(...bindings, statisticsPageSize, offset).all<ArticleViewQueryRow>(),
    db.prepare("SELECT slug, title FROM articles ORDER BY lower(title), id").all<{ slug: string; title: string }>()
  ]);
  const total = Number(count?.total ?? 0);
  return {
    records: (records.results ?? []).map(formatArticleViewRecord),
    articles: articles.results ?? [],
    page: filters.page,
    limit: statisticsPageSize,
    total,
    hasMore: offset + (records.results?.length ?? 0) < total
  };
}
```

Add these private definitions so returned records use camelCase and never include `visitor_hash`:

```ts
interface ArticleViewQueryRow {
  id: number;
  slug: string;
  title: string;
  ip_address: string;
  user_agent: string;
  device_type: ArticleViewDeviceType;
  os_name: string;
  browser_name: string;
  viewed_at: string;
}

function formatArticleViewRecord(row: ArticleViewQueryRow) {
  return {
    id: row.id,
    articleSlug: row.slug,
    articleTitle: row.title,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    deviceType: row.device_type,
    osName: row.os_name,
    browserName: row.browser_name,
    viewedAt: row.viewed_at
  };
}

function toSqliteTimestamp(value: Date) {
  return value.toISOString().slice(0, 19).replace("T", " ");
}
```

- [ ] **Step 4: Wire statistics and view counts into the Pages Function**

Modify `functions/api/[[path]].ts` to:

1. Import `StatisticsFilterError`, `listArticleViewStatistics`, `parseStatisticsFilters`, and `recordArticleView`.
2. Add `view_count: number` to `ArticleRow`.
3. Route `GET /api/statistics` through `requireAuth`, convert `StatisticsFilterError` to `ApiError("BAD_REQUEST", ..., 400)`, and return `listArticleViewStatistics`.
4. Include `view_count` in every article `SELECT` and `RETURNING` list.
5. Add `viewCount: Number(row.view_count ?? 0)` in `articleWithTags`.
6. After article access/password checks and before formatting the response, call `recordArticleView` only when `authenticated === false`. If it returns `true`, increment the in-memory `article.view_count` by one. Catch and log tracking errors so the article response still succeeds.

The counting block should be structurally equivalent to:

```ts
if (!authenticated) {
  try {
    if (await recordArticleView(env.DB, article.id, request, env.SESSION_SECRET)) {
      article.view_count = Number(article.view_count ?? 0) + 1;
    }
  } catch (error) {
    console.error("Failed to record article view", error);
  }
}
```

- [ ] **Step 5: Add a public-response regression assertion**

Extend the existing helper tests or add an exported formatter test so an article row with `view_count: 7` produces `viewCount: 7`, and confirm the serialized public shape contains no `ipAddress`, `userAgent`, or `visitorHash` keys.

- [ ] **Step 6: Run backend tests and type checking**

Run:

```bash
pnpm exec vitest run functions/api/articleStatistics.test.ts functions/api/helpers.test.ts
pnpm typecheck:functions
```

Expected: both test files pass and Functions TypeScript exits 0.

- [ ] **Step 7: Commit the server feature**

```bash
git add functions/api/articleStatistics.ts functions/api/articleStatistics.test.ts functions/api/[[path]].ts functions/api/helpers.test.ts
git commit -m "feat: record and query article views"
```

## Task 4: Add Frontend Statistics Contracts and API Helpers

**Files:**
- Modify: `src/types.ts`
- Modify: `src/api.ts`
- Create: `src/statistics.ts`
- Create: `src/statistics.test.ts`

- [ ] **Step 1: Write failing query helper tests**

Create `src/statistics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildStatisticsSearch, deviceTypeLabel, formatStatisticsTime } from "./statistics";

describe("statistics UI helpers", () => {
  it("serializes only active filters and the page", () => {
    expect(buildStatisticsSearch({ article: "post 1", ip: "203.0.113", device: "", from: "2026-07-01", to: "2026-07-22" }, 2)).toBe(
      "article=post+1&ip=203.0.113&from=2026-07-01&to=2026-07-22&page=2"
    );
  });
  it("labels stored device types", () => {
    expect(deviceTypeLabel("desktop")).toBe("桌面设备");
    expect(deviceTypeLabel("mobile")).toBe("手机");
    expect(deviceTypeLabel("unknown")).toBe("未知设备");
  });
  it("formats D1 UTC timestamps for display", () => {
    expect(formatStatisticsTime("2026-07-22 08:00:00")).not.toContain("Invalid");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run src/statistics.test.ts
```

Expected: FAIL because `src/statistics.ts` is missing.

- [ ] **Step 3: Add frontend contracts**

Modify `src/types.ts` so `ArticleSummary` includes:

```ts
viewCount: number;
```

Add:

```ts
export interface ArticleViewRecord {
  id: number;
  articleSlug: string;
  articleTitle: string;
  ipAddress: string;
  userAgent: string;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  osName: string;
  browserName: string;
  viewedAt: string;
}

export interface StatisticsFilters {
  article: string;
  ip: string;
  device: string;
  from: string;
  to: string;
}

export interface ArticleViewStatisticsResponse {
  records: ArticleViewRecord[];
  articles: Array<{ slug: string; title: string }>;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}
```

- [ ] **Step 4: Implement query and display helpers**

Create `src/statistics.ts` with:

```ts
import type { ArticleViewRecord, StatisticsFilters } from "./types";

export const emptyStatisticsFilters: StatisticsFilters = { article: "", ip: "", device: "", from: "", to: "" };

export function buildStatisticsSearch(filters: StatisticsFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.article) params.set("article", filters.article);
  if (filters.ip.trim()) params.set("ip", filters.ip.trim());
  if (filters.device.trim()) params.set("device", filters.device.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("page", String(page));
  return params.toString();
}

export function deviceTypeLabel(value: ArticleViewRecord["deviceType"]) {
  return { desktop: "桌面设备", mobile: "手机", tablet: "平板", unknown: "未知设备" }[value];
}

export function formatStatisticsTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(`${value.replace(" ", "T")}Z`));
}
```

- [ ] **Step 5: Add the API client**

Modify `src/api.ts` imports and add:

```ts
export async function listArticleViewStatistics(filters: StatisticsFilters, page = 1) {
  const query = buildStatisticsSearch(filters, page);
  return requestJson<ArticleViewStatisticsResponse>(`/api/statistics?${query}`);
}
```

Import `buildStatisticsSearch` from `./statistics` and the new response/filter types from `./types`.

- [ ] **Step 6: Run the focused test and frontend type check**

Run:

```bash
pnpm exec vitest run src/statistics.test.ts
pnpm exec tsc -b
```

Expected: tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit the frontend contracts**

```bash
git add src/types.ts src/api.ts src/statistics.ts src/statistics.test.ts
git commit -m "feat: add statistics frontend contracts"
```

## Task 5: Build the Administrator Statistics Page

**Files:**
- Create: `src/StatisticsPage.tsx`
- Create: `src/StatisticsPage.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write a failing presentational table test**

Create `src/StatisticsPage.test.tsx` using `renderToStaticMarkup` and an exported `StatisticsResultsTable`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatisticsResultsTable } from "./StatisticsPage";

it("renders article, IP, parsed device data, and an expandable User-Agent control", () => {
  const html = renderToStaticMarkup(
    <StatisticsResultsTable
      expandedIds={new Set()}
      onToggle={() => undefined}
      records={[{
        id: 1,
        articleSlug: "post-1",
        articleTitle: "测试文章",
        ipAddress: "203.0.113.8",
        userAgent: "Mozilla/5.0 test-agent",
        deviceType: "desktop",
        osName: "Windows 10",
        browserName: "Chrome 126",
        viewedAt: "2026-07-22 08:00:00"
      }]}
    />
  );
  expect(html).toContain("测试文章");
  expect(html).toContain("203.0.113.8");
  expect(html).toContain("Windows 10");
  expect(html).toContain("Chrome 126");
  expect(html).toContain("展开 User-Agent");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run src/StatisticsPage.test.tsx
```

Expected: FAIL because `StatisticsPage.tsx` is missing.

- [ ] **Step 3: Implement the table and page state**

Create `src/StatisticsPage.tsx` with this complete state and rendering structure:

```tsx
import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw, Search } from "lucide-react";
import { listArticleViewStatistics } from "./api";
import { deviceTypeLabel, emptyStatisticsFilters, formatStatisticsTime } from "./statistics";
import type { ArticleViewRecord, ArticleViewStatisticsResponse, StatisticsFilters } from "./types";

export function StatisticsPage() {
  const [draftFilters, setDraftFilters] = useState<StatisticsFilters>({ ...emptyStatisticsFilters });
  const [filters, setFilters] = useState<StatisticsFilters>({ ...emptyStatisticsFilters });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ArticleViewStatisticsResponse | null>(null);
  const [articleOptions, setArticleOptions] = useState<Array<{ slug: string; title: string }>>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");
    setResult(null);
    setExpandedIds(new Set());

    void listArticleViewStatistics(filters, page)
      .then((nextResult) => {
        if (requestId !== requestIdRef.current) return;
        setResult(nextResult);
        setArticleOptions(nextResult.articles);
      })
      .catch((caught: unknown) => {
        if (requestId !== requestIdRef.current) return;
        setError(caught instanceof Error ? caught.message : "统计数据加载失败");
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [filters, page]);

  function setFilter<Key extends keyof StatisticsFilters>(key: Key, value: StatisticsFilters[Key]) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setFilters({ ...draftFilters });
  }

  function reset() {
    const empty = { ...emptyStatisticsFilters };
    setDraftFilters(empty);
    setPage(1);
    setFilters(empty);
  }

  function toggleAgent(id: number) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="statistics-page">
      <div className="statistics-heading">
        <div>
          <h1>访问统计</h1>
          <p>{result ? `共 ${result.total} 条访问记录` : "查询文章访问明细"}</p>
        </div>
      </div>

      <form className="statistics-filter-form" onSubmit={submit}>
        <label>
          文章
          <select value={draftFilters.article} onChange={(event) => setFilter("article", event.target.value)}>
            <option value="">全部文章</option>
            {articleOptions.map((article) => <option value={article.slug} key={article.slug}>{article.title}</option>)}
          </select>
        </label>
        <label>
          IP
          <input value={draftFilters.ip} onChange={(event) => setFilter("ip", event.target.value)} placeholder="完整 IP 或片段" />
        </label>
        <label>
          设备 / 系统 / 浏览器
          <input value={draftFilters.device} onChange={(event) => setFilter("device", event.target.value)} placeholder="例如 Chrome、iOS" />
        </label>
        <label>
          开始日期
          <input type="date" value={draftFilters.from} onChange={(event) => setFilter("from", event.target.value)} />
        </label>
        <label>
          结束日期
          <input type="date" value={draftFilters.to} onChange={(event) => setFilter("to", event.target.value)} />
        </label>
        <div className="statistics-filter-actions">
          <button className="text-button primary" type="submit" disabled={loading}><Search size={16} />查询</button>
          <button className="icon-button subtle" type="button" onClick={reset} disabled={loading} title="重置查询" aria-label="重置查询"><RotateCcw size={17} /></button>
        </div>
      </form>

      {loading && <div className="statistics-loading" aria-live="polite">统计数据加载中...</div>}
      {!loading && error && <div className="empty-state"><h2>统计数据加载失败</h2><p>{error}</p></div>}
      {!loading && !error && result && result.records.length === 0 && <div className="empty-state"><h2>没有匹配的访问记录</h2><p>调整查询条件后再试。</p></div>}
      {!loading && !error && result && result.records.length > 0 && (
        <StatisticsResultsTable records={result.records} expandedIds={expandedIds} onToggle={toggleAgent} />
      )}

      {!loading && !error && result && result.total > 0 && (
        <div className="statistics-pagination">
          <button className="icon-button subtle" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1} title="上一页" aria-label="上一页"><ChevronLeft size={18} /></button>
          <span>第 {result.page} 页</span>
          <button className="icon-button subtle" type="button" onClick={() => setPage((current) => current + 1)} disabled={!result.hasMore} title="下一页" aria-label="下一页"><ChevronRight size={18} /></button>
        </div>
      )}
    </div>
  );
}

export function StatisticsResultsTable(props: {
  records: ArticleViewRecord[];
  expandedIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <div className="statistics-table-wrap">
      <table className="statistics-table">
        <thead><tr><th>访问时间</th><th>文章</th><th>IP</th><th>设备</th><th>操作系统</th><th>浏览器</th><th>User-Agent</th></tr></thead>
        <tbody>
          {props.records.map((record) => {
            const expanded = props.expandedIds.has(record.id);
            return (
              <Fragment key={record.id}>
                <tr>
                  <td>{formatStatisticsTime(record.viewedAt)}</td>
                  <td title={record.articleTitle}>{record.articleTitle}</td>
                  <td>{record.ipAddress}</td>
                  <td>{deviceTypeLabel(record.deviceType)}</td>
                  <td>{record.osName}</td>
                  <td>{record.browserName}</td>
                  <td><div className="statistics-user-agent"><span className="statistics-user-agent-text">{record.userAgent || "unknown"}</span><button className="icon-button subtle" type="button" onClick={() => props.onToggle(record.id)} title={expanded ? "收起 User-Agent" : "展开 User-Agent"} aria-label={expanded ? "收起 User-Agent" : "展开 User-Agent"}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button></div></td>
                </tr>
                {expanded && <tr className="statistics-expanded-agent"><td colSpan={7}>{record.userAgent || "unknown"}</td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Add page styling**

Extend `src/styles.css` with focused classes:

```css
.statistics-page { width: min(1180px, 100%); margin: 0 auto; }
.statistics-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.statistics-filter-form { display: grid; grid-template-columns: minmax(180px, 1.2fr) repeat(2, minmax(150px, 1fr)) repeat(2, minmax(140px, .7fr)) auto; gap: 12px; align-items: end; margin-bottom: 22px; }
.statistics-filter-form label { display: grid; gap: 6px; min-width: 0; color: #5f665f; font-size: 13px; }
.statistics-filter-form input,
.statistics-filter-form select { width: 100%; min-height: 42px; border: 1px solid #ddd9cf; border-radius: 8px; background: #fff; padding: 0 10px; color: #202124; }
.statistics-table-wrap { width: 100%; overflow-x: auto; border-top: 1px solid #ddd9cf; border-bottom: 1px solid #ddd9cf; }
.statistics-table { width: 100%; min-width: 1040px; border-collapse: collapse; table-layout: fixed; }
.statistics-table th,
.statistics-table td { padding: 12px 10px; border-bottom: 1px solid #ece9df; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.statistics-user-agent { display: flex; align-items: flex-start; gap: 6px; }
.statistics-user-agent-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.statistics-expanded-agent td { padding-top: 0; color: #5f665f; font-family: ui-monospace, monospace; }
.statistics-pagination { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 18px; }
```

At `max-width: 1100px`, collapse the form to three columns. At `max-width: 820px`, collapse it to one column so direct mobile URLs remain usable even though navigation is hidden.

- [ ] **Step 5: Run the component test and build**

Run:

```bash
pnpm exec vitest run src/StatisticsPage.test.tsx src/statistics.test.ts
pnpm exec tsc -b
```

Expected: tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit the statistics page**

```bash
git add src/StatisticsPage.tsx src/StatisticsPage.test.tsx src/styles.css
git commit -m "feat: add administrator statistics page"
```

## Task 6: Wire Routing, Navigation, and Public Counts

**Files:**
- Create: `src/ArticleViewCount.tsx`
- Create: `src/ArticleViewCount.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write a failing shared-count component test**

Create `src/ArticleViewCount.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArticleViewCount } from "./ArticleViewCount";

it("renders an accessible compact article view count", () => {
  const html = renderToStaticMarkup(<ArticleViewCount count={128} />);
  expect(html).toContain("128 次浏览");
  expect(html).toContain("article-view-count");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run src/ArticleViewCount.test.tsx
```

Expected: FAIL because `ArticleViewCount.tsx` is missing.

- [ ] **Step 3: Implement the shared count**

Create `src/ArticleViewCount.tsx`:

```tsx
import { Eye } from "lucide-react";

export function ArticleViewCount(props: { count: number }) {
  const count = Number.isFinite(props.count) ? Math.max(0, props.count) : 0;
  return (
    <span className="article-view-count" title={`${count} 次浏览`}>
      <Eye size={14} aria-hidden="true" />
      <span>{count} 次浏览</span>
    </span>
  );
}
```

- [ ] **Step 4: Add `/statistics` routing and navigation**

Modify `src/App.tsx` to:

- Import `BarChart3`, `StatisticsPage`, and `ArticleViewCount`.
- Extend `View` to include `"statistics"` and add `const statisticsPath = "/statistics"`.
- Recognize `/statistics` during initial route parsing and `popstate` handling.
- Update the document title to `特医365 - 访问统计` for the statistics view.
- Add `showStatistics(pushUrl = true)` that clears article-only state, sets the view, scrolls to top, and pushes `/statistics`.
- When an administrator logs out while on the statistics view, return to the article list.
- Render the statistics navigation button immediately before the guestbook button only when authenticated:

```tsx
{authenticated && (
  <button className="text-button statistics-nav-button" type="button" onClick={() => showStatistics()}>
    <BarChart3 size={16} />
    统计
  </button>
)}
```

- Render `<StatisticsPage />` when `view === "statistics" && authenticated`; render the existing login-required empty state for a direct unauthenticated route.

- [ ] **Step 5: Place the public counts**

In `ArticleList`, place `<ArticleViewCount count={article.viewCount} />` next to the updated date inside a new `.article-row-meta` wrapper. In `ArticleView`, place `<ArticleViewCount count={props.article.viewCount} />` after the date in `.article-meta`.

- [ ] **Step 6: Add responsive and metadata CSS**

Extend `src/styles.css`:

```css
.article-row-meta,
.article-view-count { display: inline-flex; align-items: center; gap: 6px; }
.article-row-meta { flex-wrap: wrap; gap: 10px; color: #6f756d; font-size: 13px; }
.article-view-count { min-width: 76px; color: #6f756d; white-space: nowrap; }

@media (max-width: 820px) {
  .statistics-nav-button { display: none; }
}
```

Keep the existing eye icon used by the visibility control; do not remove its import from `App.tsx` unless it becomes genuinely unused.

- [ ] **Step 7: Run focused and full frontend checks**

Run:

```bash
pnpm exec vitest run src/ArticleViewCount.test.tsx src/StatisticsPage.test.tsx src/statistics.test.ts
pnpm exec tsc -b
```

Expected: tests pass and TypeScript exits 0.

- [ ] **Step 8: Commit the integrated frontend**

```bash
git add src/ArticleViewCount.tsx src/ArticleViewCount.test.tsx src/App.tsx src/styles.css
git commit -m "feat: show article views and statistics navigation"
```

## Task 7: Document, Verify, Migrate Production, and Deploy

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

Document:

- Public article view counts use a 30-minute IP + User-Agent cooldown.
- Logged-in administrator views are excluded.
- Administrator statistics are available from the desktop navigation and include permanent full IP and User-Agent retention.
- Filters: article, IP substring, device/browser/system keyword, and inclusive date range.
- Add `0007_article_view_statistics.sql` to the migration list.

- [ ] **Step 2: Run the complete automated verification suite**

Run:

```bash
pnpm test
pnpm build
pnpm typecheck:functions
pnpm db:migrate:local
git diff --check
```

Expected: all tests pass, both TypeScript projects pass, Vite builds, local D1 reports no pending migration errors, and diff check is clean. The existing Vite chunk-size advisory is acceptable; new errors are not.

- [ ] **Step 3: Check encoding and removed-provider regressions**

Run targeted searches that verify newly written Chinese remains literal UTF-8, no long `????` corruption exists, and removed image hosts were not reintroduced:

```bash
rg -n "\?{4,}|catbox|pixeldrain" src functions migrations README.md
```

Expected: no matches. Existing intentional Unicode code-point ranges in regular expressions are allowed and should not be rewritten.

- [ ] **Step 4: Run local API and D1 smoke tests**

Start the built Pages app with the existing local environment variables, then verify:

1. A public article response contains `viewCount`.
2. Two requests with the same `CF-Connecting-IP` and `User-Agent` within 30 minutes increase the count only once.
3. A request with a different IP or User-Agent increases it again.
4. `GET /api/statistics` returns `403` without an administrator session.
5. After login, the statistics endpoint returns records and never returns `visitorHash`.

Use `wrangler d1 execute ... --local` to inspect `articles.view_count`, `article_views`, and `article_view_visitors` after the requests.

- [ ] **Step 5: Perform browser QA at desktop and mobile widths**

Use Playwright against the local Pages server:

- Desktop `1440x1000`: log in, confirm “统计” appears left of “留言板”, exercise all filters, expand one User-Agent, paginate if data permits, and verify article list/detail counts.
- Mobile `390x844`: confirm `.statistics-nav-button` is absent from layout and the topbar does not overlap; directly visit `/statistics` once to verify the fallback layout remains readable.
- Capture screenshots for both viewports and inspect them for text overflow, incoherent overlap, blank data surfaces, and unintended layout shifts.

- [ ] **Step 6: Commit documentation and any verification-only fixes**

```bash
git add README.md src functions migrations package.json pnpm-lock.yaml
git diff --cached --check
git commit -m "docs: document article view statistics"
```

If no verification fixes are needed and README is the only change, commit only README. Do not stage unrelated files.

- [ ] **Step 7: Apply the production D1 migration**

First inspect pending remote migrations, then apply the additive migration:

```bash
pnpm exec wrangler d1 migrations list cloudflare_blog --remote
pnpm db:migrate:remote
```

Expected: only `0007_article_view_statistics.sql` is pending before application, and it succeeds. This migration is additive and does not delete existing article data.

- [ ] **Step 8: Push and verify Cloudflare Pages**

```bash
git status --short
git push origin main
pnpm exec wrangler pages deployment list --project-name yc-blog
```

Expected: the worktree contains no task changes, `main` pushes successfully, and the newest production deployment is `Active` with the pushed commit SHA. Verify the custom domain returns HTTP 200 before reporting completion.

## Final Acceptance Checklist

- [ ] Public list and detail responses expose `viewCount` and no visitor details.
- [ ] Same article + IP + User-Agent is counted at most once per rolling 30 minutes.
- [ ] Administrator reads do not create events or increment counts.
- [ ] Permanent records contain full IP, parsed device/OS/browser, original User-Agent, article, and timestamp.
- [ ] Statistics filters, reset, pagination, loading, empty, error, and User-Agent expansion work.
- [ ] Statistics API requires authentication and uses bound SQL parameters.
- [ ] Desktop navigation order is Statistics then Guestbook; statistics navigation is hidden at `820px` and below.
- [ ] Tests, type checks, build, local migration, API smoke tests, browser QA, production migration, deployment, and live HTTP check pass.
