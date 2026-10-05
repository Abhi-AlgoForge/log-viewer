import { describe, it, expect } from "vitest";
import { defaultDocViewMode, docKindForName } from "../utils/docKind";

describe("docKindForName", () => {
  it("detects markdown by extension, case-insensitively", () => {
    expect(docKindForName("C:\\notes\\README.MD")).toBe("markdown");
    expect(docKindForName("/tmp/changes.markdown")).toBe("markdown");
  });

  it("detects json documents", () => {
    expect(docKindForName("/etc/app/config.json")).toBe("json");
  });

  it("leaves logs and line-delimited json alone", () => {
    expect(docKindForName("app.log")).toBeNull();
    expect(docKindForName("events.jsonl")).toBeNull();
    expect(docKindForName("events.ndjson")).toBeNull();
    expect(docKindForName("notes.md.gz")).toBeNull();
    expect(docKindForName(null)).toBeNull();
  });
});

describe("defaultDocViewMode", () => {
  it("opens markdown side by side and json as text", () => {
    expect(defaultDocViewMode("markdown")).toBe("split");
    expect(defaultDocViewMode("json")).toBe("text");
  });
});
