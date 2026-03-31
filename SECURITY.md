# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older versions | No |

## Reporting a Vulnerability

If you discover a security vulnerability in Tap, please report it responsibly:

1. **Do NOT open a public issue.**
2. Email **security@leontingtap.com** or use [GitHub Security Advisories](https://github.com/LeonTing1010/tap/security/advisories/new) to report privately.
3. Include: description, reproduction steps, affected versions, and potential impact.

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Model

Tap operates within your browser via a Chrome Extension (Manifest V3). Key security properties:

- **No remote code execution.** `.tap.js` scripts are deterministic JavaScript loaded from local disk (`~/.tap/taps/` and `~/.tap/skills/`). No code is fetched from the network at runtime.
- **No credential exfiltration.** Taps run in the context of your existing browser session. They do not extract, store, or transmit cookies, tokens, or passwords. The `page.cookies()` and `page.storage()` tools are read-only inspection tools for debugging.
- **Chrome Extensions API first.** Tap uses `chrome.scripting` (undetectable by websites) for page evaluation. CDP (`chrome.debugger`) is used only for input events (pointer/keyboard) and CSP fallback, and requires explicit user permission.
- **Local-only daemon.** The WebSocket daemon listens on `localhost:9333` / `localhost:9334` only. No remote connections are accepted.
- **No telemetry.** Tap collects no analytics, usage data, or crash reports.

## Scope

The following are in scope for security reports:

- Remote code execution via crafted `.tap.js` files
- Privilege escalation beyond declared Chrome extension permissions
- Data exfiltration through the daemon WebSocket relay
- Cross-tab data leakage in multi-tab scenarios

The following are out of scope:

- Vulnerabilities in websites that taps interact with
- Social engineering attacks requiring user to install malicious taps
- Denial of service against the local daemon
