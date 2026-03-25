#!/bin/sh
set -e

CONFIG_DIR="/home/zts/.local/share/zettelkasten"
CONFIG="$CONFIG_DIR/config.json5"
SERVER_CONFIG="/server-data/.local/share/zettelkasten/config.json5"

mkdir -p "$CONFIG_DIR"

# Generate agent config from server's config (shared volume, read-only)
if [ ! -f "$CONFIG" ]; then
  # Wait for server config to appear (server may still be initializing)
  for i in $(seq 1 30); do
    [ -f "$SERVER_CONFIG" ] && break
    echo "Waiting for server config... ($i)"
    sleep 1
  done

  if [ ! -f "$SERVER_CONFIG" ]; then
    echo "error: server config not found at $SERVER_CONFIG after 30s"
    exit 1
  fi

  # Extract devToken from server config
  DEV_TOKEN=$(grep devToken "$SERVER_CONFIG" | head -1 | sed 's/.*"\(.*\)".*/\1/')
  if [ -z "$DEV_TOKEN" ]; then
    echo "error: could not extract devToken from server config"
    exit 1
  fi

  cat > "$CONFIG" <<CONF
{
  serverUrl: "http://zts-server:7483",
  serverPort: 7483,
  checkerPort: 7484,
  checkerUrl: "http://zts-checker:7484",
  devToken: "${DEV_TOKEN}",
  embedUrl: "http://ollama:11434/api/embeddings",
  embedModel: "nomic-embed-text",
  embedDim: 768,
}
CONF
  echo "Generated agent config (devToken from server)"
fi

# Lock config read-only so agent can't accidentally overwrite via zts init
chmod 400 "$CONFIG" 2>/dev/null || true

# Fix workspace volume ownership
sudo chown -R zts:zts /home/zts/workspaces 2>/dev/null || true

exec "$@"
