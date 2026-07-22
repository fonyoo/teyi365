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
