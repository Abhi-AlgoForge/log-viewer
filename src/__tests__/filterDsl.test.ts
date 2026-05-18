import { describe, it, expect } from "vitest";
import { tokenize, filterHighlightRegex } from "../utils/filterDsl";

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("foo bar baz")).toEqual(["foo", "bar", "baz"]);
  });

  it("keeps regex blocks intact", () => {
    expect(tokenize("/foo bar/ baz")).toEqual(["/foo bar/", "baz"]);
  });

  it("handles escaped slash inside regex", () => {
    expect(tokenize("/api\\/users/ extra")).toEqual(["/api\\/users/", "extra"]);
  });

  it("mixes DSL filters and substrings", () => {
    expect(tokenize("level:error since:5m payment")).toEqual([
      "level:error",
      "since:5m",
      "payment",
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("filterHighlightRegex", () => {
  it("returns null for empty / whitespace queries", () => {
    expect(filterHighlightRegex("")).toBeNull();
    expect(filterHighlightRegex("   ")).toBeNull();
  });

  it("returns null when only DSL filters present", () => {
    expect(filterHighlightRegex("level:error since:5m")).toBeNull();
  });

  it("builds regex from a /.../ block", () => {
    const re = filterHighlightRegex("/conn\\w+ refused/");
    expect(re).not.toBeNull();
    expect(re!.flags).toContain("i");
    expect("connection refused".match(re!)).not.toBeNull();
  });

  it("escapes substrings safely", () => {
    const re = filterHighlightRegex("(payment)");
    expect(re).not.toBeNull();
    expect("got (payment) failure".match(re!)).not.toBeNull();
  });

  it("returns null for invalid regex bodies", () => {
    expect(filterHighlightRegex("/[unclosed/")).toBeNull();
  });

  it("matches case-insensitively on substring", () => {
    const re = filterHighlightRegex("ERROR");
    expect(re).not.toBeNull();
    expect("here is an error message".match(re!)).not.toBeNull();
  });
});
