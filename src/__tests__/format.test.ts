import { describe, it, expect } from "vitest";
import { formatBytes, formatHms, formatDateTime } from "../utils/format";

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats KB", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("formats MB", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("formats GB with 2 decimals", () => {
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });
});

describe("formatHms", () => {
  it("returns empty for nullish", () => {
    expect(formatHms(null)).toBe("");
    expect(formatHms(undefined)).toBe("");
  });

  it("returns HH:MM:SS.mmm slice", () => {
    const ms = Date.UTC(2026, 0, 1, 12, 34, 56, 789);
    expect(formatHms(ms)).toBe("12:34:56.789");
  });
});

describe("formatDateTime", () => {
  it("renders YYYY-MM-DD HH:MM:SS", () => {
    const ms = Date.UTC(2026, 4, 18, 9, 8, 7);
    expect(formatDateTime(ms)).toBe("2026-05-18 09:08:07");
  });
});
