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

const statisticsMaxPage = 1_000_000; // Largest page accepted from administrator queries.
const articleViewCooldownSeconds = 30 * 60; // Rolling cooldown before one visitor can count the same article again.
const statisticsPageSize = 20; // Fixed number of article-view records returned per administrator page.

/** Internal row selected for an administrator article-view record. */
interface ArticleViewQueryRow {
  id: number;
  slug: string;
  title: string;
  ip_address: string;
  user_agent: string;
  device_type: string;
  os_name: string;
  browser_name: string;
  viewed_at: string;
}

/** Identifies invalid administrator statistics query parameters. */
export class StatisticsFilterError extends Error {}

/** Converts a raw User-Agent into the device fields stored with an article view. */
export function parseArticleViewDevice(userAgent: string) {
  if (!userAgent.trim()) {
    return { deviceType: "unknown" as const, osName: "unknown", browserName: "unknown" };
  }

  const result = new UAParser(userAgent).getResult();
  const parsedType = result.device.type;
  let deviceType: ArticleViewDeviceType;
  if (parsedType === "mobile" || parsedType === "tablet") {
    deviceType = parsedType;
  } else if (parsedType || (!result.browser.name && !result.os.name)) {
    deviceType = "unknown";
  } else {
    deviceType = "desktop";
  }
  return {
    deviceType,
    osName: joinAgentName(result.os.name, result.os.version),
    browserName: joinAgentName(result.browser.name, result.browser.version)
  };
}

/** Joins a parsed agent name and version while preserving an explicit unknown value. */
function joinAgentName(name?: string, version?: string) {
  return [name, version].filter(Boolean).join(" ") || "unknown";
}

/** Creates the private visitor identity used by the article view cooldown. */
export async function articleViewVisitorHash(secret: string, ipAddress: string, userAgent: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const identity = `article-view:${ipAddress}\n${userAgent}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Escapes values used with a SQL LIKE expression and an explicit backslash escape. */
export function escapeStatisticsLike(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Returns the inclusive cooldown boundary used by the conditional visitor claim. */
export function articleViewCutoff(now: Date) {
  return toSqliteTimestamp(new Date(now.getTime() - articleViewCooldownSeconds * 1000));
}

/** Builds the exact claim cleanup used after a permanent view batch fails. */
export function buildArticleViewClaimCleanup(articleId: number, visitorHash: string, countedAt: string) {
  return {
    sql: "DELETE FROM article_view_visitors WHERE article_id = ? AND visitor_hash = ? AND last_counted_at = ?",
    bindings: [articleId, visitorHash, countedAt]
  };
}

/** Builds bound administrator filters without interpolating any user-provided values. */
export function buildStatisticsWhere(filters: StatisticsFilters) {
  const clauses: string[] = [];
  const bindings: string[] = [];

  if (filters.article) {
    clauses.push("a.slug = ?");
    bindings.push(filters.article);
  }
  if (filters.ip) {
    clauses.push("av.ip_address LIKE ? ESCAPE '\\'");
    bindings.push(`%${escapeStatisticsLike(filters.ip)}%`);
  }
  if (filters.device) {
    const match = `%${escapeStatisticsLike(filters.device)}%`; // Literal substring shared by all device fields.
    clauses.push(
      "(av.device_type LIKE ? ESCAPE '\\' OR av.os_name LIKE ? ESCAPE '\\' OR av.browser_name LIKE ? ESCAPE '\\' OR av.user_agent LIKE ? ESCAPE '\\')"
    );
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

/** Records one eligible article view and atomically keeps its detail row and counter aligned. */
export async function recordArticleView(
  db: D1Database,
  articleId: number,
  request: Request,
  secret: string,
  now = new Date()
) {
  const ipAddress =
    request.headers.get("CF-Connecting-IP")?.trim() ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";
  const userAgent = request.headers.get("User-Agent")?.trim() || "";
  const visitorHash = await articleViewVisitorHash(secret, ipAddress, userAgent);
  const countedAt = toSqliteTimestamp(now); // One timestamp shared by the cooldown claim and permanent detail.
  const claim = await db
    .prepare(
      `
        INSERT INTO article_view_visitors (article_id, visitor_hash, last_counted_at)
        VALUES (?, ?, ?)
        ON CONFLICT(article_id, visitor_hash) DO UPDATE SET last_counted_at = excluded.last_counted_at
        WHERE article_view_visitors.last_counted_at <= ?
        RETURNING article_id
      `
    )
    .bind(articleId, visitorHash, countedAt, articleViewCutoff(now))
    .first<{ article_id: number }>();

  if (!claim) return false;

  const device = parseArticleViewDevice(userAgent);
  try {
    await db.batch([
      db
        .prepare(
          `
            INSERT INTO article_views
              (article_id, ip_address, visitor_hash, user_agent, device_type, os_name, browser_name, viewed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .bind(
          articleId,
          ipAddress,
          visitorHash,
          userAgent,
          device.deviceType,
          device.osName,
          device.browserName,
          countedAt
        ),
      db.prepare("UPDATE articles SET view_count = view_count + 1 WHERE id = ?").bind(articleId)
    ]);
  } catch (error) {
    const cleanup = buildArticleViewClaimCleanup(articleId, visitorHash, countedAt);
    try {
      await db.prepare(cleanup.sql).bind(...cleanup.bindings).run();
    } catch (cleanupError) {
      console.error("Failed to compensate article view claim", cleanupError);
    }
    throw error;
  }
  return true;
}

/** Lists permanent view details and filter options for an authenticated administrator. */
export async function listArticleViewStatistics(db: D1Database, filters: StatisticsFilters) {
  const { where, bindings } = buildStatisticsWhere(filters);
  const offset = (filters.page - 1) * statisticsPageSize; // Rows skipped before the requested statistics page.
  const [count, records, articles] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total FROM article_views av JOIN articles a ON a.id = av.article_id ${where}`)
      .bind(...bindings)
      .first<{ total: number }>(),
    db
      .prepare(
        `
          SELECT av.id, a.slug, a.title, av.ip_address, av.user_agent, av.device_type,
                 av.os_name, av.browser_name, av.viewed_at
          FROM article_views av
          JOIN articles a ON a.id = av.article_id
          ${where}
          ORDER BY av.viewed_at DESC, av.id DESC
          LIMIT ? OFFSET ?
        `
      )
      .bind(...bindings, statisticsPageSize, offset)
      .all<ArticleViewQueryRow>(),
    db.prepare("SELECT slug, title FROM articles ORDER BY lower(title), id").all<{ slug: string; title: string }>()
  ]);
  const total = Number(count?.total ?? 0); // Total records matching the administrator's filters.
  const resultRows = records.results ?? []; // Current page rows returned by D1.

  return {
    records: resultRows.map(formatArticleViewRecord),
    articles: articles.results ?? [],
    page: filters.page,
    limit: statisticsPageSize,
    total,
    hasMore: offset + resultRows.length < total
  };
}

/** Maps an internal D1 row to the administrator response without exposing visitor hashes. */
export function formatArticleViewRecord(row: ArticleViewQueryRow) {
  const deviceType: ArticleViewDeviceType =
    row.device_type === "desktop" || row.device_type === "mobile" || row.device_type === "tablet"
      ? row.device_type
      : "unknown";

  return {
    id: row.id,
    articleSlug: row.slug,
    articleTitle: row.title,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    deviceType,
    osName: row.os_name,
    browserName: row.browser_name,
    viewedAt: row.viewed_at
  };
}

/** Formats a Date as the normalized UTC text used by SQLite and D1. */
function toSqliteTimestamp(value: Date) {
  return value.toISOString().slice(0, 23).replace("T", " ");
}

/** Validates and normalizes administrator statistics filters from a request URL. */
export function parseStatisticsFilters(url: URL): StatisticsFilters {
  const article = boundedFilter(url.searchParams.get("article") ?? "", 200);
  const ip = boundedFilter(url.searchParams.get("ip") ?? "", 120);
  const device = boundedFilter(url.searchParams.get("device") ?? "", 200);
  const fromDate = parseDate(url.searchParams.get("from") ?? "");
  const toDate = parseDate(url.searchParams.get("to") ?? "");
  const toExclusiveDate = toDate ? nextUtcDay(toDate) : null;

  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new StatisticsFilterError("开始日期不能晚于结束日期");
  }

  return {
    article,
    ip,
    device,
    from: fromDate ? sqliteDate(fromDate) : "",
    toExclusive: toExclusiveDate ? sqliteDate(toExclusiveDate) : "",
    page: positivePage(url.searchParams.get("page"))
  };
}

/** Trims a text filter and enforces its storage-safe maximum length. */
function boundedFilter(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new StatisticsFilterError("查询条件过长");
  }
  return trimmed;
}

/** Parses a strict UTC calendar date without accepting JavaScript date rollover. */
function parseDate(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StatisticsFilterError("日期格式不正确");
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new StatisticsFilterError("日期格式不正确");
  }
  return parsed;
}

/** Advances a date while keeping the SQL boundary within four-digit years. */
function nextUtcDay(value: Date) {
  const next = new Date(value.getTime() + 86_400_000);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(next.toISOString())) {
    throw new StatisticsFilterError("日期格式不正确");
  }
  return next;
}

/** Formats a UTC day boundary for lexicographically sortable D1 timestamps. */
function sqliteDate(value: Date) {
  return `${value.toISOString().slice(0, 10)} 00:00:00`;
}

/** Returns a one-based integer page or the first page for invalid input. */
function positivePage(value: string | null) {
  if (!value || !/^[0-9]+$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= statisticsMaxPage ? parsed : 1;
}
