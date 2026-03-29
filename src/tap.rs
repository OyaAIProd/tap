use std::path::Path;

/// Health contract: output quality assertions for a tap.
#[derive(Debug, Clone, Default)]
pub struct HealthContract {
    pub min_rows: Option<usize>,
    pub non_empty: Option<Vec<String>>,
}

#[derive(Debug)]
pub struct TapInfo {
    pub site: String,
    pub name: String,
    pub description: String,
}

/// Scan directories for .tap.js files and return metadata.
pub fn list_taps(base_dirs: &[&str]) -> Vec<TapInfo> {
    let mut taps = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for base in base_dirs {
        let base_path = Path::new(base);
        let Ok(sites) = std::fs::read_dir(base_path) else {
            continue;
        };

        for site_entry in sites.flatten() {
            if !site_entry.path().is_dir() {
                continue;
            }
            let site_name = site_entry.file_name().to_string_lossy().to_string();
            if site_name.starts_with('_') || site_name == "demo" {
                continue;
            }

            let Ok(files) = std::fs::read_dir(site_entry.path()) else {
                continue;
            };
            for file_entry in files.flatten() {
                let path = file_entry.path();
                let filename = path.file_name().and_then(|f| f.to_str()).unwrap_or("");

                let Some(tap_name) = filename.strip_suffix(".tap.js") else {
                    continue;
                };

                let key = format!("{}/{}", site_name, tap_name);
                if seen.contains(&key) {
                    continue;
                }
                seen.insert(key);

                let description = std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|c| extract_js_string(&c, "description"))
                    .unwrap_or_default();

                taps.push(TapInfo {
                    site: site_name.clone(),
                    name: tap_name.to_string(),
                    description,
                });
            }
        }
    }
    taps.sort_by(|a, b| (&a.site, &a.name).cmp(&(&b.site, &b.name)));
    taps
}

/// Extract a quoted string field from .tap.js source.
/// Matches: description: "some text" or description: 'some text'
fn extract_js_string(content: &str, field: &str) -> Option<String> {
    let needle = format!("{}:", field);
    let pos = content.find(&needle)? + needle.len();
    let rest = content[pos..].trim_start();
    let quote = rest.as_bytes().first()?;
    if *quote != b'"' && *quote != b'\'' {
        return None;
    }
    let q = *quote as char;
    let start = 1;
    let end = rest[start..].find(q)?;
    Some(rest[start..start + end].to_string())
}

/// Standard tap search directories.
pub fn tap_dirs() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    vec![
        "extension-v2/taps".to_string(),
        format!("{}/.tap/taps", home),
    ]
}

/// Parse a HealthContract from a JSON value.
pub fn parse_health_contract(value: &serde_json::Value) -> Option<HealthContract> {
    let obj = value.as_object()?;
    Some(HealthContract {
        min_rows: obj
            .get("min_rows")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize),
        non_empty: obj.get("non_empty").and_then(|v| {
            v.as_array().map(|a| {
                a.iter()
                    .filter_map(|s| s.as_str().map(String::from))
                    .collect()
            })
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn list_taps_finds_tapjs() {
        let taps = list_taps(&["extension-v2/taps"]);
        assert!(
            taps.len() >= 40,
            "should have 40+ taps, got {}",
            taps.len()
        );
    }

    #[test]
    fn list_taps_empty_dir() {
        let taps = list_taps(&["/nonexistent/path"]);
        assert!(taps.is_empty());
    }

    #[test]
    fn tap_dirs_v2_only() {
        let dirs = tap_dirs();
        assert_eq!(dirs.len(), 2);
        assert!(dirs[0].contains("extension-v2/taps"));
        assert!(dirs[1].contains(".tap/taps"));
    }

    #[test]
    fn extract_js_double_quotes() {
        let js = r#"  description: "Hacker News top stories","#;
        assert_eq!(
            extract_js_string(js, "description").unwrap(),
            "Hacker News top stories"
        );
    }

    #[test]
    fn extract_js_single_quotes() {
        assert_eq!(
            extract_js_string("description: 'GitHub Trending'", "description").unwrap(),
            "GitHub Trending"
        );
    }

    #[test]
    fn extract_js_missing() {
        assert!(extract_js_string("site: 'github'", "description").is_none());
    }

    #[test]
    fn parse_health_contract_full() {
        let hc =
            parse_health_contract(&json!({"min_rows": 5, "non_empty": ["title", "url"]})).unwrap();
        assert_eq!(hc.min_rows, Some(5));
        assert_eq!(
            hc.non_empty,
            Some(vec!["title".to_string(), "url".to_string()])
        );
    }

    #[test]
    fn parse_health_contract_partial() {
        let hc = parse_health_contract(&json!({"min_rows": 3})).unwrap();
        assert_eq!(hc.min_rows, Some(3));
        assert!(hc.non_empty.is_none());
    }

    #[test]
    fn taps_no_js_click_injection() {
        let taps_dir = std::path::Path::new("extension-v2/taps");
        let mut violations = Vec::new();
        for site in std::fs::read_dir(taps_dir).unwrap().flatten() {
            if !site.path().is_dir() {
                continue;
            }
            for f in std::fs::read_dir(site.path()).unwrap().flatten() {
                let p = f.path();
                if !p.extension().map_or(false, |e| e == "js") {
                    continue;
                }
                let c = std::fs::read_to_string(&p).unwrap();
                for (i, line) in c.lines().enumerate() {
                    let t = line.trim();
                    if t.contains("page.click") {
                        continue;
                    }
                    if t.contains(".click()") || t.contains("dispatchEvent") {
                        violations.push(format!("{}:{}: {}", p.display(), i + 1, t));
                    }
                }
            }
        }
        assert!(
            violations.is_empty(),
            "Use page.click() not JS .click():\n{}",
            violations.join("\n")
        );
    }
}
