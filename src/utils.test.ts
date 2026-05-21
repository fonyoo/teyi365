import { describe, expect, it } from "vitest";
import { parseTags, toTagInput } from "./utils";

describe("tag helpers", () => {
  it("parses comma and Chinese comma separated tags", () => {
    expect(parseTags("Cloudflare, Markdown，D1")).toEqual(["Cloudflare", "Markdown", "D1"]);
  });

  it("trims and de-duplicates tags", () => {
    expect(parseTags("Cloudflare, Cloudflare,  D1  ")).toEqual(["Cloudflare", "D1"]);
  });

  it("serializes tags for editing", () => {
    expect(toTagInput([{ name: "Cloudflare" }, { name: "Markdown" }])).toBe("Cloudflare, Markdown");
  });
});
