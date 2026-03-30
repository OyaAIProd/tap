#!/bin/sh
set -e

# Install Deno if not present
if ! command -v deno >/dev/null 2>&1; then
  echo "Installing Deno..."
  curl -fsSL https://deno.land/install.sh | sh
  export PATH="$HOME/.deno/bin:$PATH"
fi

# Clone and compile tap
REPO="LeonTing1010/tap"
INSTALL_DIR="${TAP_INSTALL_DIR:-/usr/local/bin}"

echo "Installing tap..."
TMPDIR=$(mktemp -d)
git clone --depth 1 "https://github.com/$REPO.git" "$TMPDIR/tap"
deno compile --allow-all --output "$INSTALL_DIR/tap" "$TMPDIR/tap/src/cli.ts"
rm -rf "$TMPDIR"

echo "tap installed to $INSTALL_DIR/tap"
echo ""
echo "Next: load the Chrome extension"
echo "  1. Open chrome://extensions/"
echo "  2. Enable Developer mode"
echo "  3. Load unpacked: tap/extension"
