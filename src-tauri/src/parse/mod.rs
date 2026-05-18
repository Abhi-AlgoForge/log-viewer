//! Per-line parsing: timestamp, level, and message extraction.
//!
//! Designed to be fast (microseconds per line) so we can run it on every line
//! fetched by the frontend. Detection is heuristic — when a line clearly looks
//! like JSON we parse it; otherwise we run regex/byte-search for common
//! patterns.

use chrono::{DateTime, NaiveDateTime, Utc};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
}

impl Level {
    pub fn from_str_loose(s: &str) -> Option<Self> {
        let s = s.trim().to_ascii_lowercase();
        Some(match s.as_str() {
            "trace" | "trc" | "t" => Self::Trace,
            "debug" | "dbg" | "d" => Self::Debug,
            "info" | "inf" | "i" | "notice" => Self::Info,
            "warn" | "warning" | "wrn" | "w" => Self::Warn,
            "error" | "err" | "e" => Self::Error,
            "fatal" | "critical" | "crit" | "alert" | "emerg" => Self::Fatal,
            _ => return None,
        })
    }
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLine {
    pub timestamp: Option<i64>,
    /// Original timestamp text as it appeared in the source — preserved at
    /// full precision (microseconds, timezone, etc.) so the UI can render
    /// without losing detail to ms rounding.
    pub timestamp_str: Option<String>,
    pub level: Option<Level>,
    pub message: Option<String>,
}

static LEVEL_TOKEN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|FATAL|CRITICAL|ALERT|EMERG)\b",
    )
    .unwrap()
});

// ISO 8601 / RFC 3339 at start of line. Accepts `.` or `,` as the fractional
// separator (Python's `logging` module defaults to `,`). Fractional part is
// optional, timezone is optional.
static ISO_TS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)",
    )
    .unwrap()
});

// Syslog: "Jan 12 14:33:01" style (no year)
static SYSLOG_TS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})").unwrap());

// epoch millis / seconds at start
static EPOCH_TS: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(\d{10,13})\b").unwrap());

pub fn parse(line: &str) -> ParsedLine {
    let trimmed = line.trim_start();
    if trimmed.starts_with('{') {
        if let Some(p) = parse_json(trimmed) {
            return p;
        }
    }
    let mut out = ParsedLine::default();
    let (ts_epoch, ts_str, ts_end) = detect_timestamp_with_span(line);
    out.timestamp = ts_epoch;
    out.timestamp_str = ts_str;
    out.level = detect_level(line);
    out.message = Some(strip_prefix(line, ts_end).to_string());
    out
}

fn parse_json(s: &str) -> Option<ParsedLine> {
    let v: serde_json::Value = serde_json::from_str(s).ok()?;
    let obj = v.as_object()?;
    let ts_value = ["ts", "time", "timestamp", "@timestamp", "asctime"]
        .iter()
        .find_map(|k| obj.get(*k));
    let timestamp = ts_value.and_then(json_timestamp);
    let timestamp_str = ts_value.and_then(|v| v.as_str().map(str::to_string));
    let level = ["level", "lvl", "severity", "levelname"]
        .iter()
        .find_map(|k| obj.get(*k))
        .and_then(|v| v.as_str().and_then(Level::from_str_loose));
    let message = ["msg", "message", "text", "log", "event"]
        .iter()
        .find_map(|k| obj.get(*k))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    Some(ParsedLine {
        timestamp,
        timestamp_str,
        level,
        message,
    })
}

fn json_timestamp(v: &serde_json::Value) -> Option<i64> {
    if let Some(n) = v.as_i64() {
        return Some(if n > 10_000_000_000 { n } else { n * 1000 });
    }
    if let Some(f) = v.as_f64() {
        let n = f as i64;
        return Some(if n > 10_000_000_000 { n } else { n * 1000 });
    }
    if let Some(s) = v.as_str() {
        return parse_iso(s);
    }
    None
}

/// Detect a leading timestamp and return (epoch_ms, original_text, end_byte_offset).
/// `end_byte_offset` points at the byte AFTER the timestamp match, useful for
/// stripping the prefix from the displayed message.
fn detect_timestamp_with_span(line: &str) -> (Option<i64>, Option<String>, usize) {
    if let Some(m) = ISO_TS.captures(line) {
        let cap = match m.get(1) {
            Some(c) => c,
            None => return (None, None, 0),
        };
        let s = cap.as_str().to_string();
        let end = m.get(0).map(|w| w.end()).unwrap_or(cap.end());
        return (parse_iso(&s), Some(s), end);
    }
    if let Some(m) = EPOCH_TS.captures(line) {
        let cap = match m.get(1) {
            Some(c) => c,
            None => return (None, None, 0),
        };
        let s = cap.as_str().to_string();
        let end = m.get(0).map(|w| w.end()).unwrap_or(cap.end());
        let raw: i64 = s.parse().unwrap_or(0);
        let ts = if raw > 10_000_000_000 { raw } else { raw * 1000 };
        return (Some(ts), Some(s), end);
    }
    if let Some(m) = SYSLOG_TS.captures(line) {
        let cap = match m.get(1) {
            Some(c) => c,
            None => return (None, None, 0),
        };
        let s = cap.as_str().to_string();
        let end = m.get(0).map(|w| w.end()).unwrap_or(cap.end());
        let with_year = format!("{} {}", Utc::now().format("%Y"), s);
        if let Ok(ndt) = NaiveDateTime::parse_from_str(&with_year, "%Y %b %d %H:%M:%S") {
            return (Some(ndt.and_utc().timestamp_millis()), Some(s), end);
        }
        return (None, Some(s), end);
    }
    (None, None, 0)
}

#[allow(dead_code)]
fn detect_timestamp(line: &str) -> Option<i64> {
    detect_timestamp_with_span(line).0
}

/// Strip the leading timestamp (already located via `ts_end`) and any
/// bracketed/bare level token immediately after it, returning the remaining
/// message body. Used so the viewer doesn't duplicate the timestamp + level
/// prefix in the message column.
///
/// The character class for inter-field separators is intentionally generous:
/// real-world formats use whitespace, `,` (CBS/Windows), `:` (RFC5424), `-`
/// or `|` (custom Java/Go layouts) between timestamp and level.
fn strip_prefix(line: &str, ts_end: usize) -> &str {
    let mut s = if ts_end > 0 && ts_end <= line.len() {
        &line[ts_end..]
    } else {
        line
    };
    s = s.trim_start_matches(|c: char| {
        c.is_whitespace() || matches!(c, ':' | '-' | '|' | ',' | ';')
    });
    if let Some(m) = LEVEL_PREFIX_RE.find(s) {
        s = &s[m.end()..];
    }
    s
}

static LEVEL_PREFIX_RE: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| {
    Regex::new(
        r"(?i)^\s*\[?(TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|FATAL|CRITICAL|ALERT|EMERG)\]?\s*[:|\-]?\s*",
    )
    .unwrap()
});

fn parse_iso(s: &str) -> Option<i64> {
    // Python logging uses comma as the fractional separator; chrono expects
    // dot. Normalize once and keep trying both forms so we don't have to
    // duplicate every format string below.
    let dotted = s.replace(',', ".");
    if let Ok(dt) = DateTime::parse_from_rfc3339(&dotted) {
        return Some(dt.timestamp_millis());
    }
    let cleaned = dotted.replace(' ', "T");
    if let Ok(dt) = DateTime::parse_from_rfc3339(&cleaned) {
        return Some(dt.timestamp_millis());
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(&cleaned, fmt) {
            return Some(ndt.and_utc().timestamp_millis());
        }
        if let Ok(ndt) = NaiveDateTime::parse_from_str(&dotted, fmt) {
            return Some(ndt.and_utc().timestamp_millis());
        }
    }
    None
}

fn detect_level(line: &str) -> Option<Level> {
    // Look at first ~200 chars to avoid scanning huge lines
    let head = if line.len() > 200 { &line[..200] } else { line };
    let m = LEVEL_TOKEN.find(head)?;
    Level::from_str_loose(m.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_extracts_fields() {
        let p = parse(
            r#"{"ts":"2026-05-16T12:34:56.789Z","level":"warn","msg":"thing failed"}"#,
        );
        assert!(p.timestamp.is_some());
        assert_eq!(p.level, Some(Level::Warn));
        assert_eq!(p.message.as_deref(), Some("thing failed"));
    }

    #[test]
    fn iso_at_start() {
        let p = parse("2026-05-16T12:34:56Z INFO server started");
        assert!(p.timestamp.is_some());
        assert_eq!(p.level, Some(Level::Info));
    }

    #[test]
    fn python_comma_fraction() {
        let p = parse("2026-05-16 12:34:56,740 [INFO] bot: session complete");
        assert!(p.timestamp.is_some());
        assert_eq!(p.timestamp_str.as_deref(), Some("2026-05-16 12:34:56,740"));
        assert_eq!(p.level, Some(Level::Info));
        assert_eq!(p.message.as_deref(), Some("bot: session complete"));
    }

    #[test]
    fn cbs_log_format() {
        // Windows Component-Based Servicing format — comma separator after
        // seconds, capitalized level word, lots of padding before the
        // component name.
        let p = parse(
            "2024-01-15 10:23:45, Info                  CBS    Loaded Servicing Stack",
        );
        assert!(p.timestamp.is_some());
        assert_eq!(p.level, Some(Level::Info));
        assert_eq!(
            p.message.as_deref(),
            Some("CBS    Loaded Servicing Stack"),
            "got: {:?}",
            p.message,
        );
    }

    #[test]
    fn cbs_warning_with_ms() {
        let p = parse("2024-01-15 10:23:45.123, Warning               CSI  retry");
        assert!(p.timestamp.is_some());
        assert_eq!(p.level, Some(Level::Warn));
        assert_eq!(p.message.as_deref(), Some("CSI  retry"));
    }

    #[test]
    fn level_bracketed() {
        let p = parse("foo [ERROR] connection refused");
        assert_eq!(p.level, Some(Level::Error));
    }

    #[test]
    fn epoch_ms() {
        let p = parse("1716000000000 WARN something");
        assert_eq!(p.timestamp, Some(1716000000000));
        assert_eq!(p.level, Some(Level::Warn));
    }

    #[test]
    fn plain_line_no_signal() {
        let p = parse("just a plain message");
        assert!(p.timestamp.is_none());
        assert!(p.level.is_none());
    }
}
