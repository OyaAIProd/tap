#!/bin/sh
set -e

# Ensure ~/.deno/bin is in PATH (not loaded by /bin/sh)
export PATH="$HOME/.deno/bin:$PATH"

# Install Deno if not present
if ! command -v deno >/dev/null 2>&1; then
  echo "Installing Deno..."
  curl -fsSL https://deno.land/install.sh | sh
fi

# Clone and compile tap
REPO="LeonTing1010/tap"
INSTALL_DIR="${TAP_INSTALL_DIR:-/usr/local/bin}"
TAP_HOME="${TAP_HOME:-$HOME/.tap}"

echo "Installing tap..."
TMPDIR=$(mktemp -d)
git clone --depth 1 "https://github.com/$REPO.git" "$TMPDIR/tap"
deno compile --allow-all --output "$INSTALL_DIR/tap" "$TMPDIR/tap/src/cli.ts"

# Install Chrome extension
mkdir -p "$TAP_HOME"
rm -rf "$TAP_HOME/extension"
cp -r "$TMPDIR/tap/extension" "$TAP_HOME/extension"

# Copy bundled taps to ~/.tap/taps/ (merge, don't wipe — preserves user taps)
mkdir -p "$TAP_HOME/taps"
cp -r "$TMPDIR/tap/extension/taps"/*/ "$TAP_HOME/taps/"

rm -rf "$TMPDIR"

echo ""
echo "tap installed to $INSTALL_DIR/tap"
echo "Chrome extension at $TAP_HOME/extension"
echo "Bundled taps at $TAP_HOME/taps/"
echo ""
echo "Next: load the Chrome extension"
echo "  1. Open chrome://extensions/"
echo "  2. Enable Developer mode"
echo "  3. Load unpacked → $TAP_HOME/extension"
