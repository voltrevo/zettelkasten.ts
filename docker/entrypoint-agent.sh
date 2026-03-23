#!/bin/sh
set -e

CONFIG_DIR="/home/zts/.local/share/zettelkasten"
CONFIG="$CONFIG_DIR/config.json5"

mkdir -p "$CONFIG_DIR"

# Generate minimal client config if not mounted
if [ ! -f "$CONFIG" ]; then
  if [ -z "$ZTS_DEV_TOKEN" ]; then
    echo "error: ZTS_DEV_TOKEN is required for the agent."
    echo "  Set it in docker-compose.yml or .env"
    exit 1
  fi
  cat > "$CONFIG" <<CONF
{
  serverUrl: "http://zts-server:7483",
  serverPort: 7483,
  checkerPort: 7484,
  checkerUrl: "http://zts-checker:7484",
  devToken: "${ZTS_DEV_TOKEN}",
  embedUrl: "http://ollama:11434/api/embeddings",
  embedModel: "nomic-embed-text",
  embedDim: 768,
}
CONF
  echo "Generated agent config at $CONFIG"
fi

# Lock config read-only so agent can't accidentally overwrite via zts init
chmod 400 "$CONFIG" 2>/dev/null || true

# Fix workspace volume ownership
sudo chown -R zts:zts /home/zts/workspaces 2>/dev/null || true

exec "$@"
