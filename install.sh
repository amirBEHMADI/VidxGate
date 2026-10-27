#!/usr/bin/env bash


set -e

echo "Installing npm dependencies..."
npm install

echo "Installing pm2 globally..."
npm install -g pm2


if command -v youtube-dl > /dev/null 2>&1; then
  echo "youtube-dl is already installed."
else
  echo "Downloading youtube-dl..."
  # Attempt to download to a location in PATH. Adjust if needed for your OS.
  curl -L https://yt-dl.org/downloads/latest/youtube-dl -o /usr/local/bin/youtube-dl || {
    echo "Failed to download youtube-dl via curl. Trying pip..."
    pip install --upgrade youtube-dl || echo "youtube-dl installation failed. Please install it manually."
  }
  chmod a+rx /usr/local/bin/youtube-dl || echo "Could not set executable permission on youtube-dl."
fi

echo "All dependencies installed. You can now start the bot with pm2 or npm run start."
