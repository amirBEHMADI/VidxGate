#!/usr/bin/env bash

set -e

echo "=== VidxGate Environment Setup & Installation ==="

# Helper to run commands with sudo if not root
run_cmd() {
  if [ "$(id -u)" -ne 0 ] && command -v sudo > /dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

REQUIRED_NODE_MAJOR=20

install_node_lts() {
  echo "Installing Node.js LTS (v22.x)..."
  if command -v apt-get > /dev/null 2>&1; then
    run_cmd apt-get update -y
    run_cmd apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_22.x | run_cmd bash -
    run_cmd apt-get install -y nodejs
  elif command -v dnf > /dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | run_cmd bash -
    run_cmd dnf install -y nodejs
  elif command -v yum > /dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | run_cmd bash -
    run_cmd yum install -y nodejs
  else
    echo "Warning: Supported package manager (apt/dnf/yum) not found. Please install Node.js >= 20 manually."
  fi
}

# 1. Check and install/upgrade Node.js LTS if needed
if command -v node > /dev/null 2>&1; then
  CURRENT_NODE_VERSION=$(node -v | sed 's/^v//')
  CURRENT_NODE_MAJOR=$(echo "$CURRENT_NODE_VERSION" | cut -d'.' -f1)
  echo "Current Node.js version: v$CURRENT_NODE_VERSION"

  if [ "$CURRENT_NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
    echo "Node.js version (v$CURRENT_NODE_VERSION) is lower than required (>= v$REQUIRED_NODE_MAJOR). Upgrading..."
    install_node_lts
  else
    echo "Node.js v$CURRENT_NODE_VERSION meets requirements."
  fi
else
  echo "Node.js is not installed."
  install_node_lts
fi

echo "Active Node.js: $(node -v) | npm: $(npm -v)"

# 2. Install project npm dependencies
echo "Installing project dependencies..."
npm install

# 3. Install PM2 globally if not present
if command -v pm2 > /dev/null 2>&1; then
  echo "PM2 is already installed: $(pm2 -v)"
else
  echo "Installing PM2 globally..."
  run_cmd npm install -g pm2
fi

# 4. Install yt-dlp (required for video downloads)
if command -v yt-dlp > /dev/null 2>&1; then
  echo "yt-dlp is already installed."
else
  echo "Downloading yt-dlp..."
  run_cmd curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp || {
    echo "Direct curl failed. Trying pip..."
    pip install --upgrade yt-dlp || pip3 install --upgrade yt-dlp || echo "Please install yt-dlp manually."
  }
  run_cmd chmod a+rx /usr/local/bin/yt-dlp 2>/dev/null || true
fi

echo "=========================================================="
echo "All dependencies and requirements installed successfully!"
echo "You can now start or restart the bot via PM2:"
echo "  pm2 restart all   (or pm2 start src/bot.js --name 'vidxgate')"
echo "=========================================================="
