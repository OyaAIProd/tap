#![recursion_limit = "256"]
mod tap;
mod bridge;
mod cdp;
mod health;
mod mcp;
mod output;

use clap::{CommandFactory, Parser, Subcommand};
use clap_complete::{generate, Shell};
use serde_json::Value;

#[derive(Parser)]
#[command(
    name = "tap",
    about = "Make every website programmable by AI",
    version
)]
#[command(allow_external_subcommands = true)]
struct Cli {
    /// Output format: table, json, csv
    #[arg(short = 'f', long, default_value = "table", global = true)]
    format: String,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List available taps (website API specs)
    List,
    /// Generate shell completions
    Completions {
        /// Shell: bash, zsh, fish, powershell, elvish
        shell: Shell,
    },

    /// Health check all taps via extension bridge
    Check,

    // ---- MCP SERVER (primary interface for AI agents) ----
    /// Run as MCP server (stdin/stdout JSON-RPC) for AI agent integration
    Mcp,

    /// Run a tap via extension bridge (tap <site> <name> [--arg value ...])
    #[command(external_subcommand)]
    Tap(Vec<String>),
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    if let Err(e) = run(cli).await {
        eprintln!("error: {}", e);
        std::process::exit(1);
    }
}

async fn run(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    match cli.command {
        Command::Mcp => {
            mcp::serve().await?;
        }
        Command::List => {
            let dirs = tap::tap_dirs();
            let refs: Vec<&str> = dirs.iter().map(|s| s.as_str()).collect();
            let taps = tap::list_taps(&refs);
            if taps.is_empty() {
                println!(
                    "No taps found. Add .tap.js files to extension/taps/ or ~/.tap/taps/"
                );
            } else {
                let columns = vec!["site".into(), "name".into(), "description".into()];
                let rows: Vec<std::collections::HashMap<String, String>> = taps
                    .iter()
                    .map(|a| {
                        let mut row = std::collections::HashMap::new();
                        row.insert("site".into(), a.site.clone());
                        row.insert("name".into(), a.name.clone());
                        row.insert("description".into(), a.description.clone());
                        row
                    })
                    .collect();
                output::print_output(&columns, &rows, &cli.format)?;
            }
        }
        Command::Check => {
            // Connect to extension bridge
            let client = bridge::try_extension_bridge().await?;

            // Get tap list from extension
            let list_result = client
                .send("Tap.list", Some(serde_json::json!({})))
                .await?;

            let taps = list_result
                .get("taps")
                .and_then(|c| c.as_array())
                .cloned()
                .unwrap_or_default();

            if taps.is_empty() {
                println!("No taps registered in extension.");
                return Ok(());
            }

            let mut healthy = 0;
            let mut degraded = 0;
            let mut broken = 0;
            let mut errors = 0;

            for tap in &taps {
                let site = tap["site"].as_str().unwrap_or("?");
                let name = tap["name"].as_str().unwrap_or("?");
                let tap_name = format!("{}/{}", site, name);

                // Run the tap
                let run_result = client
                    .send(
                        "Tap.run",
                        Some(serde_json::json!({
                            "site": site,
                            "name": name,
                            "args": {}
                        })),
                    )
                    .await;

                match run_result {
                    Err(e) => {
                        println!("{} — Error: {}", tap_name, e);
                        errors += 1;
                    }
                    Ok(result) => {
                        if let Some(err) = result.get("error") {
                            println!("{} — Error: {}", tap_name, err);
                            errors += 1;
                            continue;
                        }

                        let rows = result
                            .get("rows")
                            .and_then(|r| r.as_array())
                            .cloned()
                            .unwrap_or_default();

                        // Try to get health contract from result
                        let health_contract = result
                            .get("health")
                            .and_then(tap::parse_health_contract);

                        if let Some(contract) = health_contract {
                            let report = health::validate(&tap_name, &contract, &rows);
                            let status_str = match report.status {
                                health::HealthStatus::Healthy => {
                                    healthy += 1;
                                    "Healthy"
                                }
                                health::HealthStatus::Degraded => {
                                    degraded += 1;
                                    "Degraded"
                                }
                                health::HealthStatus::Broken => {
                                    broken += 1;
                                    "Broken"
                                }
                            };
                            let failures: Vec<&str> = report
                                .checks
                                .iter()
                                .filter(|c| !c.passed)
                                .map(|c| c.message.as_str())
                                .collect();
                            if failures.is_empty() {
                                println!("{} — {} ({} rows)", tap_name, status_str, rows.len());
                            } else {
                                println!(
                                    "{} — {} ({})",
                                    tap_name,
                                    status_str,
                                    failures.join("; ")
                                );
                            }
                        } else {
                            // No health contract — just report row count
                            healthy += 1;
                            println!(
                                "{} — OK ({} rows, no health contract)",
                                tap_name,
                                rows.len()
                            );
                        }
                    }
                }
            }

            println!(
                "\n{} taps: {} healthy, {} degraded, {} broken, {} errors",
                taps.len(),
                healthy,
                degraded,
                broken,
                errors
            );

            // Exit code: 0 = all healthy, 1 = degraded, 2 = broken/errors
            if broken > 0 || errors > 0 {
                std::process::exit(2);
            } else if degraded > 0 {
                std::process::exit(1);
            }
        }
        Command::Completions { shell } => {
            let mut cmd = Cli::command();
            generate(shell, &mut cmd, "tap", &mut std::io::stdout());
        }

        Command::Tap(raw_args) => {
            if raw_args.len() < 2 {
                return Err("usage: tap <site> <name> [--arg value ...]".into());
            }

            let site = &raw_args[0];
            let name = &raw_args[1];
            let args = parse_tap_args(&raw_args[2..]);

            // Run via Chrome extension bridge
            let client = bridge::try_extension_bridge().await?;
            let result = client
                .send(
                    "Tap.run",
                    Some(serde_json::json!({
                        "site": site,
                        "name": name,
                        "args": args
                    })),
                )
                .await?;

            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}

/// Parse --key value pairs from raw CLI args into a HashMap.
fn parse_tap_args(raw: &[String]) -> std::collections::HashMap<String, Value> {
    let mut args = std::collections::HashMap::new();
    let mut i = 0;
    while i < raw.len() {
        if let Some(key) = raw[i].strip_prefix("--") {
            if i + 1 < raw.len() && !raw[i + 1].starts_with("--") {
                let val = &raw[i + 1];
                let json_val = if let Ok(n) = val.parse::<i64>() {
                    Value::Number(n.into())
                } else if let Ok(f) = val.parse::<f64>() {
                    serde_json::Number::from_f64(f)
                        .map(Value::Number)
                        .unwrap_or_else(|| Value::String(val.clone()))
                } else {
                    Value::String(val.clone())
                };
                args.insert(key.to_string(), json_val);
                i += 2;
            } else {
                args.insert(key.to_string(), Value::Bool(true));
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_tap_args_numeric() {
        let raw: Vec<String> = vec!["--limit", "5"].into_iter().map(String::from).collect();
        let args = parse_tap_args(&raw);
        assert_eq!(args.get("limit"), Some(&json!(5)));
    }

    #[test]
    fn parse_tap_args_string() {
        let raw: Vec<String> = vec!["--query", "rust"]
            .into_iter()
            .map(String::from)
            .collect();
        let args = parse_tap_args(&raw);
        assert_eq!(args.get("query"), Some(&json!("rust")));
    }

    #[test]
    fn parse_tap_args_flag() {
        let raw: Vec<String> = vec!["--verbose"].into_iter().map(String::from).collect();
        let args = parse_tap_args(&raw);
        assert_eq!(args.get("verbose"), Some(&json!(true)));
    }
}
