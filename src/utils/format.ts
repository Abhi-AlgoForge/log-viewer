/// Shared formatting helpers used across the viewer, status bar, settings,
/// and overlays. Keep these dependency-free so they're cheap to import.

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/// Hour-precision time string for inline display (HH:MM:SS.mmm).
export function formatHms(ms: number | null | undefined): string {
  if (ms == null) return "";
  return new Date(ms).toISOString().slice(11, 23);
}

/// Date + time for histogram tooltips and similar (YYYY-MM-DD HH:MM:SS).
export function formatDateTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}
