import { describe, expect, it } from "vitest";
import {
  articleViewCutoff,
  articleViewVisitorHash,
  buildArticleViewClaimCleanup,
  buildStatisticsWhere,
  escapeStatisticsLike,
  formatArticleViewRecord,
  parseArticleViewDevice,
  parseStatisticsFilters
} from "./articleStatistics";

describe("article statistics helpers", () => {
  it("parses a Windows Chrome desktop user agent", () => {
    expect(
      parseArticleViewDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
      )
    ).toEqual({
      deviceType: "desktop",
      osName: "Windows 10",
      browserName: "Chrome 126.0.0.0"
    });
  });

  it("parses an iPhone Safari mobile user agent", () => {
    expect(
      parseArticleViewDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"
      )
    ).toEqual({
      deviceType: "mobile",
      osName: "iOS 17.5",
      browserName: "Mobile Safari 17.5"
    });
  });

  it("preserves an iPad Safari tablet device type", () => {
    expect(
      parseArticleViewDevice(
        "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"
      )
    ).toMatchObject({ deviceType: "tablet", osName: "iOS 17.5", browserName: "Mobile Safari 17.5" });
  });

  it("classifies unrecognized and unsupported device types as unknown", () => {
    expect(parseArticleViewDevice("curl/8.7.1")).toEqual({
      deviceType: "unknown",
      osName: "unknown",
      browserName: "unknown"
    });
    expect(
      parseArticleViewDevice(
        "Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4 TV Safari/538.1"
      )
    ).toMatchObject({ deviceType: "unknown", osName: "Tizen 2.4.0", browserName: "Safari 2.4" });
  });

  it("returns exact unknown values for an empty user agent", () => {
    expect(parseArticleViewDevice("")).toEqual({
      deviceType: "unknown",
      osName: "unknown",
      browserName: "unknown"
    });
  });

  it("creates stable HMAC visitor hashes from the exact visitor identity", async () => {
    const secret = "statistics-secret";
    const ipAddress = "203.0.113.8";
    const userAgent = "browser-a";
    const expectedKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const expectedSignature = await crypto.subtle.sign(
      "HMAC",
      expectedKey,
      new TextEncoder().encode(`article-view:${ipAddress}\n${userAgent}`)
    );
    const expected = Array.from(new Uint8Array(expectedSignature), (byte) => byte.toString(16).padStart(2, "0")).join("");

    const first = await articleViewVisitorHash(secret, ipAddress, userAgent);

    expect(first).toBe(expected);
    expect(first).toBe(await articleViewVisitorHash(secret, ipAddress, userAgent));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain(ipAddress);
    expect(first).not.toBe(await articleViewVisitorHash(secret, "203.0.113.9", userAgent));
    expect(first).not.toBe(await articleViewVisitorHash(secret, ipAddress, "browser-b"));
  });

  it("escapes SQL LIKE wildcard characters and backslashes", () => {
    expect(escapeStatisticsLike("100%_ok\\done")).toBe("100\\%\\_ok\\\\done");
  });

  it("uses an exact 30 minute cooldown", () => {
    expect(articleViewCutoff(new Date("2026-07-22T12:30:00.000Z"))).toBe("2026-07-22 12:00:00.000");
    expect(articleViewCutoff(new Date("2026-07-22T12:30:00.987Z"))).toBe("2026-07-22 12:00:00.987");
  });

  it("builds a conditional cleanup for only the failed view claim", () => {
    expect(buildArticleViewClaimCleanup(7, "visitor-hash", "2026-07-22 12:30:00.123")).toEqual({
      sql: "DELETE FROM article_view_visitors WHERE article_id = ? AND visitor_hash = ? AND last_counted_at = ?",
      bindings: [7, "visitor-hash", "2026-07-22 12:30:00.123"]
    });
  });

  it("builds parameterized statistics filters", () => {
    expect(
      buildStatisticsWhere({
        article: "post-1",
        ip: "203.0.113.%",
        device: "Chrome_126",
        from: "2026-07-01 00:00:00",
        toExclusive: "2026-07-23 00:00:00",
        page: 1
      })
    ).toEqual({
      where:
        "WHERE a.slug = ? AND av.ip_address LIKE ? ESCAPE '\\' AND (av.device_type LIKE ? ESCAPE '\\' OR av.os_name LIKE ? ESCAPE '\\' OR av.browser_name LIKE ? ESCAPE '\\' OR av.user_agent LIKE ? ESCAPE '\\') AND av.viewed_at >= ? AND av.viewed_at < ?",
      bindings: [
        "post-1",
        "%203.0.113.\\%%",
        "%Chrome\\_126%",
        "%Chrome\\_126%",
        "%Chrome\\_126%",
        "%Chrome\\_126%",
        "2026-07-01 00:00:00",
        "2026-07-23 00:00:00"
      ]
    });
  });

  it("omits the WHERE clause when statistics filters are empty", () => {
    expect(
      buildStatisticsWhere({
        article: "",
        ip: "",
        device: "",
        from: "",
        toExclusive: "",
        page: 1
      })
    ).toEqual({ where: "", bindings: [] });
  });

  it("formats administrator records with a validated device type and no visitor hash", () => {
    const record = formatArticleViewRecord({
      id: 3,
      slug: "post-1",
      title: "Post",
      ip_address: "203.0.113.8",
      user_agent: "test-agent",
      device_type: "console",
      os_name: "unknown",
      browser_name: "unknown",
      viewed_at: "2026-07-22 08:00:00"
    });

    expect(record).toMatchObject({
      id: 3,
      articleSlug: "post-1",
      ipAddress: "203.0.113.8",
      deviceType: "unknown"
    });
    expect(JSON.stringify(record)).not.toContain("visitorHash");
  });

  it("parses trimmed bounded filters and an inclusive date range", () => {
    const url = new URL(
      "https://example.com/api/statistics?article=%20post-1%20&ip=%20203.0.113%20&device=%20Chrome%20&from=2026-07-01&to=2026-07-22&page=2"
    );

    expect(parseStatisticsFilters(url)).toEqual({
      article: "post-1",
      ip: "203.0.113",
      device: "Chrome",
      from: "2026-07-01 00:00:00",
      toExclusive: "2026-07-23 00:00:00",
      page: 2
    });
  });

  it("accepts filter values at their length limits", () => {
    const url = new URL("https://example.com/api/statistics");
    url.searchParams.set("article", "a".repeat(200));
    url.searchParams.set("ip", "i".repeat(120));
    url.searchParams.set("device", "d".repeat(200));

    expect(parseStatisticsFilters(url)).toMatchObject({
      article: "a".repeat(200),
      ip: "i".repeat(120),
      device: "d".repeat(200)
    });
  });

  it("rejects reversed and impossible dates with clear messages", () => {
    expect(() =>
      parseStatisticsFilters(new URL("https://example.com/api/statistics?from=2026-07-23&to=2026-07-22"))
    ).toThrow("开始日期不能晚于结束日期");
    expect(() =>
      parseStatisticsFilters(new URL("https://example.com/api/statistics?from=2026-02-30"))
    ).toThrow("日期格式不正确");
    expect(() =>
      parseStatisticsFilters(new URL("https://example.com/api/statistics?to=2026-7-22"))
    ).toThrow("日期格式不正确");
  });

  it("accepts leap day and rejects an unrepresentable exclusive end date", () => {
    expect(
      parseStatisticsFilters(new URL("https://example.com/api/statistics?from=2024-02-29&to=2024-02-29"))
    ).toMatchObject({
      from: "2024-02-29 00:00:00",
      toExclusive: "2024-03-01 00:00:00"
    });
    expect(() =>
      parseStatisticsFilters(new URL("https://example.com/api/statistics?to=9999-12-31"))
    ).toThrow("日期格式不正确");
  });

  it("rejects overlong filters", () => {
    for (const [name, value] of [
      ["article", "a".repeat(201)],
      ["ip", "i".repeat(121)],
      ["device", "d".repeat(201)]
    ]) {
      const url = new URL("https://example.com/api/statistics");
      url.searchParams.set(name, value);
      expect(() => parseStatisticsFilters(url)).toThrow("查询条件过长");
    }
  });

  it("falls back to page one for invalid page values", () => {
    for (const value of ["", "0", "-1", "1.5", "two", "1e2", "+2", "1000001", "9007199254740992"]) {
      const url = new URL("https://example.com/api/statistics");
      url.searchParams.set("page", value);
      expect(parseStatisticsFilters(url).page).toBe(1);
    }
  });

  it("accepts safe decimal pages up to the configured cap", () => {
    for (const value of ["2", "0002", "1000000"]) {
      const url = new URL("https://example.com/api/statistics");
      url.searchParams.set("page", value);
      expect(parseStatisticsFilters(url).page).toBe(Number(value));
    }
  });
});
