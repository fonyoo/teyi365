import type { ArticleViewRecord, StatisticsFilters } from "./types";

/** Default filter values; callers copy this object before storing mutable form state. */
export const emptyStatisticsFilters: StatisticsFilters = {
  article: "",
  ip: "",
  device: "",
  from: "",
  to: ""
};

const d1UtcTimestampPattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;
const isoTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))?$/;
const statisticsTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "medium"
});

/** Serializes active statistics filters in the order expected by the API. */
export function buildStatisticsSearch(filters: StatisticsFilters, page: number) {
  const params = new URLSearchParams();
  const ip = filters.ip.trim();
  const device = filters.device.trim();

  if (filters.article) params.set("article", filters.article);
  if (ip) params.set("ip", ip);
  if (device) params.set("device", device);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("page", String(page));
  return params.toString();
}

/** Maps every stored device category to its administrator-facing Chinese label. */
export function deviceTypeLabel(value: ArticleViewRecord["deviceType"]) {
  switch (value) {
    case "desktop":
      return "桌面设备";
    case "mobile":
      return "手机";
    case "tablet":
      return "平板";
    case "unknown":
      return "未知设备";
    default: {
      const exhaustiveValue: never = value;
      return exhaustiveValue;
    }
  }
}

/** Formats D1 UTC timestamps and timezone-aware ISO timestamps for display. */
export function formatStatisticsTime(value: string) {
  const normalized = normalizeStatisticsTimestamp(value);
  if (!normalized) return "未知时间";
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "未知时间";
  return statisticsTimeFormatter.format(parsed);
}

/** Validates accepted timestamp fields and returns an unambiguous ISO value. */
function normalizeStatisticsTimestamp(value: string) {
  const d1Match = d1UtcTimestampPattern.exec(value);
  const match = d1Match ?? isoTimestampPattern.exec(value);
  if (!match || !hasValidTimestampFields(match)) return null;

  const normalized = d1Match ? value.replace(" ", "T") : value;
  return match[8] ? normalized : `${normalized}Z`;
}

/** Rejects calendar, clock, and timezone fields that Date would otherwise normalize. */
function hasValidTimestampFields(match: RegExpExecArray) {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[8] && match[8] !== "Z" && (Number(match[9]) > 23 || Number(match[10]) > 59)) return false;
  return true;
}
