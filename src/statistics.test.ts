import { describe, expect, it } from "vitest";
import { buildStatisticsSearch, deviceTypeLabel, formatStatisticsTime } from "./statistics";

describe("statistics UI helpers", () => {
  it("serializes active filters in API order and URL-encodes their values", () => {
    expect(
      buildStatisticsSearch(
        {
          article: "post 1",
          ip: "203.0.113",
          device: "",
          from: "2026-07-01",
          to: "2026-07-22"
        },
        2
      )
    ).toBe("article=post+1&ip=203.0.113&from=2026-07-01&to=2026-07-22&page=2");
  });

  it("trims free-text filters and omits empty filters", () => {
    expect(
      buildStatisticsSearch(
        { article: "", ip: "  203.0.113  ", device: "   ", from: "", to: "" },
        1
      )
    ).toBe("ip=203.0.113&page=1");
  });

  it("trims a non-empty device filter", () => {
    expect(
      buildStatisticsSearch(
        { article: "", ip: "", device: "  mobile  ", from: "", to: "" },
        1
      )
    ).toBe("device=mobile&page=1");
  });

  it("places a trimmed device filter between IP and date filters", () => {
    expect(
      buildStatisticsSearch(
        {
          article: "post-1",
          ip: " 203.0.113 ",
          device: " mobile ",
          from: "2026-07-01",
          to: "2026-07-22"
        },
        2
      )
    ).toBe("article=post-1&ip=203.0.113&device=mobile&from=2026-07-01&to=2026-07-22&page=2");
  });

  it("labels every stored device type", () => {
    expect(deviceTypeLabel("desktop")).toBe("桌面设备");
    expect(deviceTypeLabel("mobile")).toBe("手机");
    expect(deviceTypeLabel("tablet")).toBe("平板");
    expect(deviceTypeLabel("unknown")).toBe("未知设备");
  });

  it("treats D1 timestamps with milliseconds as UTC", () => {
    const timestamp = "2026-07-22 08:00:00.125";
    const expected = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(new Date("2026-07-22T08:00:00.125Z"));

    expect(formatStatisticsTime(timestamp)).toBe(expected);
  });

  it("treats D1 timestamps without milliseconds as UTC", () => {
    const timestamp = "2026-07-22 08:00:00";
    const expected = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(new Date("2026-07-22T08:00:00Z"));

    expect(formatStatisticsTime(timestamp)).toBe(expected);
  });

  it("preserves timestamps that already include a timezone", () => {
    const timestamp = "2026-07-22T08:00:00.125+08:00";
    const expected = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(new Date(timestamp));

    expect(formatStatisticsTime(timestamp)).toBe(expected);
  });

  it("treats timezone-less ISO timestamps as UTC", () => {
    const timestamp = "2026-07-22T08:00:00.5";
    const expected = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(new Date("2026-07-22T08:00:00.5Z"));

    expect(formatStatisticsTime(timestamp)).toBe(expected);
  });

  it("rejects invalid ISO calendar dates before timezone conversion", () => {
    expect(formatStatisticsTime("2026-02-30T08:00:00.125Z")).toBe("未知时间");
    expect(formatStatisticsTime("2026-02-30T08:00:00.125+08:00")).toBe("未知时间");
  });

  it("rejects out-of-range ISO time and timezone fields", () => {
    expect(formatStatisticsTime("2026-07-22T24:00:00Z")).toBe("未知时间");
    expect(formatStatisticsTime("2026-07-22T23:60:00Z")).toBe("未知时间");
    expect(formatStatisticsTime("2026-07-22T23:59:60Z")).toBe("未知时间");
    expect(formatStatisticsTime("2026-07-22T08:00:00+24:00")).toBe("未知时间");
    expect(formatStatisticsTime("2026-07-22T08:00:00+08:60")).toBe("未知时间");
  });

  it("rejects timestamp strings outside the accepted D1 and ISO forms", () => {
    expect(formatStatisticsTime("2026-07-22T08:00Z")).toBe("未知时间");
    expect(formatStatisticsTime("2026-07-22 08:00:00+08:00")).toBe("未知时间");
  });

  it("returns a safe label for invalid timestamps", () => {
    expect(formatStatisticsTime("not-a-time")).toBe("未知时间");
    expect(formatStatisticsTime("2026-02-30 08:00:00")).toBe("未知时间");
  });
});
