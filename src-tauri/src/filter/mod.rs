//! Filter expressions for log lines.
//!
//! Grammar is intentionally tiny and unsurprising:
//!   - `level:err,warn`        comma-separated levels
//!   - `since:5m` / `until:1h` relative time from now
//!   - `/pattern/`             regex match (case-insensitive)
//!   - anything else           case-insensitive substring on the raw line
//! Multiple terms are space-separated and combined with AND.

use crate::parse::{Level, ParsedLine};
use regex::{Regex, RegexBuilder};

#[derive(Debug, Default)]
pub struct Filter {
    pub levels: Option<Vec<Level>>,
    pub since_ms: Option<i64>,
    pub until_ms: Option<i64>,
    pub regex: Option<Regex>,
    pub substring: Option<String>,
}

impl Filter {
    pub fn is_empty(&self) -> bool {
        self.levels.is_none()
            && self.since_ms.is_none()
            && self.until_ms.is_none()
            && self.regex.is_none()
            && self.substring.is_none()
    }

    pub fn parse(input: &str) -> Self {
        let mut f = Filter::default();
        let now = chrono::Utc::now().timestamp_millis();
        for tok in tokenize(input) {
            let t = tok.trim();
            if t.is_empty() {
                continue;
            }
            if let Some(rest) = t.strip_prefix("level:") {
                let levels: Vec<Level> = rest
                    .split(',')
                    .filter_map(|s| Level::from_str_loose(s))
                    .collect();
                if !levels.is_empty() {
                    f.levels = Some(levels);
                }
                continue;
            }
            if let Some(rest) = t.strip_prefix("since:") {
                if let Some(ms) = parse_duration_ms(rest) {
                    f.since_ms = Some(now - ms);
                }
                continue;
            }
            if let Some(rest) = t.strip_prefix("until:") {
                if let Some(ms) = parse_duration_ms(rest) {
                    f.until_ms = Some(now - ms);
                }
                continue;
            }
            if t.len() >= 2 && t.starts_with('/') && t.ends_with('/') {
                let pat = &t[1..t.len() - 1];
                if let Ok(re) = RegexBuilder::new(pat).case_insensitive(true).build() {
                    f.regex = Some(re);
                }
                continue;
            }
            // Substring — concatenate multiple bare tokens with space.
            match &mut f.substring {
                None => f.substring = Some(t.to_lowercase()),
                Some(s) => {
                    s.push(' ');
                    s.push_str(&t.to_lowercase());
                }
            }
        }
        f
    }

    pub fn matches(&self, raw: &str, parsed: &ParsedLine) -> bool {
        if let Some(levels) = &self.levels {
            match parsed.level {
                Some(l) if levels.contains(&l) => {}
                _ => return false,
            }
        }
        if let Some(since) = self.since_ms {
            match parsed.timestamp {
                Some(ts) if ts >= since => {}
                _ => return false,
            }
        }
        if let Some(until) = self.until_ms {
            match parsed.timestamp {
                Some(ts) if ts <= until => {}
                _ => return false,
            }
        }
        if let Some(re) = &self.regex {
            if !re.is_match(raw) {
                return false;
            }
        }
        if let Some(sub) = &self.substring {
            if !raw.to_lowercase().contains(sub) {
                return false;
            }
        }
        true
    }
}

/// Tokenize on whitespace, but keep `/.../ ` blocks together so regex
/// patterns can contain spaces. Backslash escapes the next character inside a
/// regex block, so `\/` doesn't terminate it.
fn tokenize(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_re = false;
    let mut escape_next = false;
    for c in input.chars() {
        if in_re && escape_next {
            cur.push(c);
            escape_next = false;
            continue;
        }
        if in_re && c == '\\' {
            cur.push(c);
            escape_next = true;
            continue;
        }
        if c == '/' {
            cur.push(c);
            if in_re {
                in_re = false;
                out.push(std::mem::take(&mut cur));
            } else if cur.len() == 1 {
                in_re = true;
            }
            continue;
        }
        if c.is_whitespace() && !in_re {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            continue;
        }
        cur.push(c);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn parse_duration_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let (num, unit) = s.split_at(s.find(|c: char| c.is_alphabetic()).unwrap_or(s.len()));
    let n: i64 = num.trim().parse().ok()?;
    let mult: i64 = match unit.trim() {
        "" | "s" | "sec" | "secs" | "seconds" => 1_000,
        "m" | "min" | "mins" | "minutes" => 60_000,
        "h" | "hr" | "hrs" | "hours" => 3_600_000,
        "d" | "day" | "days" => 86_400_000,
        _ => return None,
    };
    Some(n.saturating_mul(mult))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(line: &str) -> ParsedLine {
        crate::parse::parse(line)
    }

    #[test]
    fn parses_level_filter() {
        let f = Filter::parse("level:error,warn");
        assert!(f.matches("[ERROR] x", &p("[ERROR] x")));
        assert!(f.matches("WARN x", &p("WARN x")));
        assert!(!f.matches("INFO x", &p("INFO x")));
    }

    #[test]
    fn parses_substring() {
        let f = Filter::parse("connection refused");
        assert!(f.matches("oops connection refused now", &p("oops connection refused now")));
        assert!(!f.matches("everything fine", &p("everything fine")));
    }

    #[test]
    fn parses_regex() {
        let f = Filter::parse("/conn\\w+/");
        assert!(f.matches("connection lost", &p("connection lost")));
        assert!(!f.matches("disk full", &p("disk full")));
    }

    #[test]
    fn empty_filter_is_empty() {
        assert!(Filter::parse("").is_empty());
        assert!(Filter::parse("   ").is_empty());
    }

    #[test]
    fn duration_parsing() {
        assert_eq!(parse_duration_ms("5s"), Some(5_000));
        assert_eq!(parse_duration_ms("5"), Some(5_000));
        assert_eq!(parse_duration_ms("2m"), Some(120_000));
        assert_eq!(parse_duration_ms("3h"), Some(10_800_000));
        assert_eq!(parse_duration_ms("1d"), Some(86_400_000));
        assert_eq!(parse_duration_ms("xyz"), None);
    }
}
