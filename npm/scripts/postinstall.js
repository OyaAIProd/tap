#!/usr/bin/env node
/**
 * postinstall — downloads the correct Tap binary for this platform.
 *
 * Release assets are tar.gz (unix) or zip (windows):
 *   tap-aarch64-apple-darwin.tar.gz
 *   tap-x86_64-apple-darwin.tar.gz
 *   tap-x86_64-unknown-linux-gnu.tar.gz
 *   tap-x86_64-pc-windows-msvc.zip
 *
 * Extracts the `tap` binary and renames to `tap-{target}[.exe]`.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = "LeonTing1010/tap";

const TARGET_MAP = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
};

async function getLatestRelease() {
  const url = `https://api.github.com/repos/${REPO}/releases/latest`;
  return new Promise((resolve, reject) => {
    const get = (u) => {
      https.get(u, { headers: { "User-Agent": "tap-mcp-postinstall" } }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          get(res.headers.location);
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          resolve(JSON.parse(data));
        });
      }).on("error", reject);
    };
    get(url);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u) => {
      https.get(u, { headers: { "User-Agent": "tap-mcp-postinstall" } }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", reject);
    };
    get(url);
  });
}

async function main() {
  const target = TARGET_MAP[`${os.platform()}-${os.arch()}`];
  if (!target) {
    console.log(`tap-mcp: unsupported platform ${os.platform()}/${os.arch()}, skipping`);
    return;
  }

  const isWindows = os.platform() === "win32";
  const ext = isWindows ? ".exe" : "";
  const binaryDest = path.join(__dirname, "..", "bin", `tap-${target}${ext}`);

  if (fs.existsSync(binaryDest)) {
    console.log(`tap-mcp: binary exists`);
    return;
  }

  const archiveExt = isWindows ? ".zip" : ".tar.gz";
  const assetName = `tap-${target}${archiveExt}`;

  console.log(`tap-mcp: downloading ${assetName}...`);

  try {
    const release = await getLatestRelease();
    const asset = release.assets?.find((a) => a.name === assetName);
    if (!asset) {
      console.log(`tap-mcp: no asset ${assetName} in release, skipping`);
      console.log(`  Available: ${release.assets?.map((a) => a.name).join(", ") || "none"}`);
      console.log(`  Build manually: deno compile --allow-all --output tap src/cli.ts`);
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-mcp-"));
    const archivePath = path.join(tmpDir, assetName);

    await download(asset.browser_download_url, archivePath);

    // Extract binary
    const binDir = path.join(__dirname, "..", "bin");
    if (isWindows) {
      // PowerShell extraction for zip
      execSync(
        `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}'"`,
      );
      fs.copyFileSync(path.join(tmpDir, "tap.exe"), binaryDest);
    } else {
      execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`);
      fs.copyFileSync(path.join(tmpDir, "tap"), binaryDest);
      fs.chmodSync(binaryDest, 0o755);
    }

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });

    console.log(`tap-mcp: installed (${(fs.statSync(binaryDest).size / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.log(`tap-mcp: download failed (${err.message}), will use PATH fallback`);
  }
}

main();
