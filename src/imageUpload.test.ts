import { describe, expect, it } from "vitest";
import { markdownImage, orderedImageHostProviders } from "./imageUpload";

describe("image upload helpers", () => {
  it("skips providers whose local failure cooldown is active", () => {
    expect(orderedImageHostProviders({ catbox: 9_000 }, 10_000)).toEqual(["pixeldrain"]);
  });

  it("retries every provider when all providers are cooling down", () => {
    expect(orderedImageHostProviders({ catbox: 9_000, pixeldrain: 9_000 }, 10_000)).toEqual(["catbox", "pixeldrain"]);
  });

  it("creates Markdown image syntax", () => {
    expect(markdownImage("https://example.com/image.webp", "截图")).toBe("![截图](https://example.com/image.webp)");
  });
});
