//! Drain-style pattern clustering.
//!
//! Each line is tokenized, variable-looking tokens (numbers, hex IDs, UUIDs,
//! IPs) are replaced with `<*>`, and the resulting token sequence is matched
//! against existing templates bucketed by token-count. If similarity exceeds a
//! threshold we merge the line into the matching template (turning the
//! differing positions into `<*>`); otherwise we open a new template.
//!
//! The output is a list of templates with their occurrence counts, level
//! breakdown, and a sample of source line numbers. The frontend turns a
//! template back into a regex filter when the user clicks it.

use crate::parse::Level;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;

const SIM_THRESHOLD: f32 = 0.55;
const MAX_SAMPLES: usize = 20;
const MAX_TEMPLATES_PER_BUCKET: usize = 100;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternView {
    pub id: u64,
    pub template: String,
    pub regex: String,
    pub count: u64,
    pub sample_lines: Vec<u64>,
    pub level: Option<Level>,
}

#[derive(Default)]
pub struct PatternTree {
    next_id: u64,
    buckets: HashMap<usize, Vec<Pattern>>,
    total_lines: u64,
}

struct Pattern {
    id: u64,
    tokens: Vec<Token>,
    count: u64,
    sample_lines: Vec<u64>,
    level_counts: HashMap<Level, u64>,
}

#[derive(Clone, PartialEq)]
enum Token {
    Lit(String),
    Wild,
}

impl Token {
    fn render(&self) -> &str {
        match self {
            Token::Lit(s) => s,
            Token::Wild => "<*>",
        }
    }
}

impl PatternTree {
    pub fn new() -> Self {
        Self::default()
    }

    /// Cheap count for progress events — avoids building/sorting the full
    /// view list on every emit.
    pub fn pattern_count(&self) -> usize {
        self.buckets.values().map(|v| v.len()).sum()
    }

    pub fn ingest(&mut self, line_no: u64, raw: &str, level: Option<Level>) {
        let body = strip_known_prefix(raw);
        let tokens = tokenize(body);
        if tokens.is_empty() {
            return;
        }
        self.total_lines += 1;
        let bucket = self.buckets.entry(tokens.len()).or_default();

        // Best match
        let mut best: Option<(usize, f32)> = None;
        for (ix, pat) in bucket.iter().enumerate() {
            let sim = similarity(&pat.tokens, &tokens);
            if sim >= SIM_THRESHOLD && best.map_or(true, |(_, b)| sim > b) {
                best = Some((ix, sim));
            }
        }

        if let Some((ix, _)) = best {
            let pat = &mut bucket[ix];
            for (i, t) in tokens.iter().enumerate() {
                if pat.tokens[i] != *t {
                    pat.tokens[i] = Token::Wild;
                }
            }
            pat.count += 1;
            if pat.sample_lines.len() < MAX_SAMPLES {
                pat.sample_lines.push(line_no);
            }
            if let Some(l) = level {
                *pat.level_counts.entry(l).or_insert(0) += 1;
            }
        } else if bucket.len() < MAX_TEMPLATES_PER_BUCKET {
            let id = self.next_id;
            self.next_id += 1;
            let mut level_counts = HashMap::new();
            if let Some(l) = level {
                level_counts.insert(l, 1);
            }
            bucket.push(Pattern {
                id,
                tokens,
                count: 1,
                sample_lines: vec![line_no],
                level_counts,
            });
        }
        // Else: bucket is full; drop the line. Real Drain3 would split the
        // bucket further; we keep v0.1 simple.
    }

    pub fn to_views(&self) -> Vec<PatternView> {
        let mut out: Vec<PatternView> = self
            .buckets
            .values()
            .flatten()
            // Drop templates that are mostly wildcards — they degrade to
            // "match anything with N tokens" and are useless as filters.
            .filter(|p| {
                let wilds = p.tokens.iter().filter(|t| matches!(t, Token::Wild)).count();
                let total = p.tokens.len().max(1);
                // Keep if at least one literal AND wildcard ratio under 70%.
                wilds < p.tokens.len() && (wilds * 10) / total < 7
            })
            .map(|p| {
                let dom_level = p
                    .level_counts
                    .iter()
                    .max_by_key(|(_, c)| **c)
                    .map(|(l, _)| *l);
                PatternView {
                    id: p.id,
                    template: p
                        .tokens
                        .iter()
                        .map(|t| t.render())
                        .collect::<Vec<_>>()
                        .join(" "),
                    regex: template_to_regex(&p.tokens),
                    count: p.count,
                    sample_lines: p.sample_lines.clone(),
                    level: dom_level,
                }
            })
            .collect();
        out.sort_by(|a, b| b.count.cmp(&a.count));
        out
    }
}

fn tokenize(s: &str) -> Vec<Token> {
    s.split_whitespace()
        .map(|w| {
            let cleaned = w.trim_matches(|c: char| matches!(c, ',' | ';' | '"' | '\'' | '`'));
            if cleaned.is_empty() {
                Token::Lit(w.to_string())
            } else if is_variable(cleaned) {
                Token::Wild
            } else {
                Token::Lit(w.to_string())
            }
        })
        .collect()
}

fn is_variable(t: &str) -> bool {
    // All-digit (with optional sign / decimal)
    if t.chars().all(|c| c.is_ascii_digit() || c == '.' || c == '-')
        && t.chars().any(|c| c.is_ascii_digit())
    {
        return true;
    }
    // UUID
    if t.len() == 36 && is_uuid(t) {
        return true;
    }
    // Long hex
    if t.len() >= 8 && t.chars().all(|c| c.is_ascii_hexdigit()) {
        return true;
    }
    // IPv4
    if is_ipv4(t) {
        return true;
    }
    false
}

fn is_uuid(t: &str) -> bool {
    let bytes = t.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (i, &b) in bytes.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if b != b'-' {
                    return false;
                }
            }
            _ => {
                if !(b as char).is_ascii_hexdigit() {
                    return false;
                }
            }
        }
    }
    true
}

fn is_ipv4(t: &str) -> bool {
    let parts: Vec<&str> = t.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    parts.iter().all(|p| p.parse::<u8>().is_ok())
}

fn similarity(a: &[Token], b: &[Token]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let matches = a
        .iter()
        .zip(b.iter())
        .filter(|(x, y)| match (x, y) {
            (Token::Wild, _) | (_, Token::Wild) => true,
            (Token::Lit(s), Token::Lit(t)) => s == t,
        })
        .count();
    matches as f32 / a.len() as f32
}

fn template_to_regex(tokens: &[Token]) -> String {
    let mut s = String::from("(?i)");
    for (i, t) in tokens.iter().enumerate() {
        if i > 0 {
            s.push_str(r"\s+");
        }
        match t {
            Token::Wild => s.push_str(r"\S+"),
            Token::Lit(lit) => {
                // regex::escape handles regex metacharacters but not `/`,
                // which is a delimiter in our filter DSL — escape it too so
                // the user can paste the regex into the filter bar without
                // it being chopped in half on paths like /var/log/foo.
                let escaped = regex::escape(lit).replace('/', r"\/");
                s.push_str(&escaped);
            }
        }
    }
    s
}

static TS_PREFIX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^\s*\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)\]?\s*",
    )
    .unwrap()
});

static LEVEL_PREFIX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*\[?(?i:TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|FATAL|CRITICAL|ALERT|EMERG)\]?\s*").unwrap());

/// Strip a leading timestamp and bracketed level so clustering keys on the
/// *message body* rather than the per-line timestamp prefix.
fn strip_known_prefix(raw: &str) -> &str {
    let mut s = raw;
    if let Some(m) = TS_PREFIX.find(s) {
        s = &s[m.end()..];
    }
    if let Some(m) = LEVEL_PREFIX.find(s) {
        s = &s[m.end()..];
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clusters_similar_lines() {
        let mut t = PatternTree::new();
        t.ingest(0, "User 12345 logged in", None);
        t.ingest(1, "User 67890 logged in", None);
        t.ingest(2, "User abcdef1234 logged in", None);
        t.ingest(3, "Disk full", None);
        let views = t.to_views();
        // Two distinct templates
        assert!(views.iter().any(|v| v.template.contains("User") && v.count == 3));
        assert!(views.iter().any(|v| v.template.contains("Disk")));
    }

    #[test]
    fn variable_detection() {
        assert!(is_variable("12345"));
        assert!(is_variable("3a4b5c6d"));
        assert!(is_variable("550e8400-e29b-41d4-a716-446655440000"));
        assert!(is_variable("192.168.1.1"));
        assert!(!is_variable("foo"));
    }

    #[test]
    fn template_regex_roundtrip() {
        let mut t = PatternTree::new();
        t.ingest(0, "fetched 5 items in 30ms", None);
        t.ingest(1, "fetched 9 items in 31ms", None);
        let views = t.to_views();
        let v = &views[0];
        let re = regex::Regex::new(&v.regex).unwrap();
        assert!(re.is_match("fetched 200 items in 1500ms"));
    }
}
