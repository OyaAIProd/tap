use std::collections::HashMap;

/// Format rows as an aligned table.
pub fn format_table(columns: &[String], rows: &[HashMap<String, String>]) -> String {
    // Calculate column widths
    let mut widths: Vec<usize> = columns.iter().map(|c| c.len()).collect();
    for row in rows {
        for (i, col) in columns.iter().enumerate() {
            let val_len = row.get(col).map(|s| s.len()).unwrap_or(0);
            if val_len > widths[i] {
                widths[i] = val_len;
            }
        }
    }

    let mut lines = Vec::with_capacity(rows.len() + 3);

    // Header
    let header: Vec<String> = columns
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{:<width$}", c, width = widths[i]))
        .collect();
    lines.push(header.join("  "));

    // Separator
    let sep: Vec<String> = widths.iter().map(|w| "-".repeat(*w)).collect();
    lines.push(sep.join("  "));

    // Rows
    for row in rows {
        let vals: Vec<String> = columns
            .iter()
            .enumerate()
            .map(|(i, col)| {
                let val = row.get(col).map(|s| s.as_str()).unwrap_or("");
                format!("{:<width$}", val, width = widths[i])
            })
            .collect();
        lines.push(vals.join("  "));
    }

    lines.join("\n")
}

/// Format rows as JSON array.
pub fn format_json(columns: &[String], rows: &[HashMap<String, String>]) -> String {
    let filtered: Vec<serde_json::Map<String, serde_json::Value>> = rows
        .iter()
        .map(|row| {
            let mut map = serde_json::Map::new();
            for col in columns {
                let val = row.get(col).cloned().unwrap_or_default();
                map.insert(col.clone(), serde_json::Value::String(val));
            }
            map
        })
        .collect();
    serde_json::to_string_pretty(&filtered).unwrap_or_default()
}

/// Format rows as CSV (RFC 4180 basic).
pub fn format_csv(columns: &[String], rows: &[HashMap<String, String>]) -> String {
    let mut lines = Vec::with_capacity(rows.len() + 1);
    lines.push(columns.join(","));
    for row in rows {
        let vals: Vec<String> = columns
            .iter()
            .map(|col| {
                let val = row.get(col).cloned().unwrap_or_default();
                if val.contains(',') || val.contains('"') || val.contains('\n') {
                    format!("\"{}\"", val.replace('"', "\"\""))
                } else {
                    val
                }
            })
            .collect();
        lines.push(vals.join(","));
    }
    lines.join("\n")
}

/// Print rows in the specified format.
pub fn print_output(
    columns: &[String],
    rows: &[HashMap<String, String>],
    format: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    match format {
        "table" => println!("{}", format_table(columns, rows)),
        "json" => println!("{}", format_json(columns, rows)),
        "csv" => println!("{}", format_csv(columns, rows)),
        other => {
            return Err(format!("unknown format: {} (expected: table, json, csv)", other).into())
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_table_basic() {
        let columns = vec!["title".to_string(), "views".to_string()];
        let mut row = HashMap::new();
        row.insert("title".to_string(), "Hello".to_string());
        row.insert("views".to_string(), "1000".to_string());
        let output = format_table(&columns, &vec![row]);
        assert!(output.contains("title"));
        assert!(output.contains("Hello"));
        assert!(output.contains("1000"));
    }

    #[test]
    fn format_table_missing_column() {
        let columns = vec!["name".to_string(), "age".to_string()];
        let mut row = HashMap::new();
        row.insert("name".to_string(), "Alice".to_string());
        let output = format_table(&columns, &vec![row]);
        assert!(output.contains("Alice"));
        assert!(output.contains("name"));
        assert!(output.contains("age"));
    }

    #[test]
    fn format_table_empty_rows() {
        let columns = vec!["id".to_string(), "status".to_string()];
        let output = format_table(&columns, &vec![]);
        assert!(output.contains("id"));
        assert!(output.contains("status"));
    }

    #[test]
    fn format_json_produces_valid_json() {
        let columns = vec!["title".to_string(), "views".to_string()];
        let mut row = HashMap::new();
        row.insert("title".to_string(), "Hello".to_string());
        row.insert("views".to_string(), "1000".to_string());
        let json_str = format_json(&columns, &vec![row]);
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(parsed[0]["title"], "Hello");
    }

    #[test]
    fn format_csv_has_correct_headers() {
        let columns = vec!["name".to_string(), "age".to_string()];
        let mut row = HashMap::new();
        row.insert("name".to_string(), "Alice".to_string());
        row.insert("age".to_string(), "30".to_string());
        let csv_str = format_csv(&columns, &vec![row]);
        let lines: Vec<&str> = csv_str.lines().collect();
        assert_eq!(lines[0], "name,age");
        assert_eq!(lines[1], "Alice,30");
    }

    #[test]
    fn format_csv_quotes_commas() {
        let columns = vec!["title".to_string()];
        let mut row = HashMap::new();
        row.insert("title".to_string(), "hello, world".to_string());
        let csv_str = format_csv(&columns, &vec![row]);
        assert!(csv_str.contains("\"hello, world\""));
    }
}
