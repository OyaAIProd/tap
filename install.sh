#!/bin/sh
set -e

REPO="LeonTing1010/webclaw"
INSTALL_DIR="${WEBCLAW_INSTALL_DIR:-/usr/local/bin}"
BINARY="webclaw"

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64|aarch64) TARGET="aarch64-apple-darwin" ;;
      x86_64)        TARGET="x86_64-apple-darwin" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64) TARGET="x86_64-unknown-linux-gnu" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

# Get latest release tag
TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
if [ -z "$TAG" ]; then
  echo "Failed to get latest release"
  exit 1
fi

echo "Installing $BINARY $TAG ($TARGET)..."

# Download and extract
URL="https://github.com/$REPO/releases/download/$TAG/$BINARY-$TARGET.tar.gz"
curl -fsSL "$URL" | tar -xz -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/$BINARY"

echo "$BINARY $TAG installed to $INSTALL_DIR/$BINARY"
echo ""
echo "Next: install the Chrome extension"
echo "  1. Download webclaw-extension.zip from https://github.com/$REPO/releases/latest"
echo "  2. Unzip and load in chrome://extensions/ (developer mode)"
