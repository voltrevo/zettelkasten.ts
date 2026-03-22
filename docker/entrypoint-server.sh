#!/bin/sh
set -e

DATA_DIR="/data/.local/share/zettelkasten"
CONFIG="$DATA_DIR/config.json5"

mkdir -p "$DATA_DIR"

# Generate config on first run
if [ ! -f "$CONFIG" ]; then
  DEV_TOKEN=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  ADMIN_TOKEN=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat > "$CONFIG" <<CONF
{
  devToken: "${DEV_TOKEN}",
  adminToken: "${ADMIN_TOKEN}",
  serverUrl: "http://zts-server:7483",
  serverPort: 7483,
  checkerPort: 7484,
  checkerUrl: "http://zts-checker:7484",
  embedUrl: "http://ollama:11434/api/embeddings",
  embedModel: "nomic-embed-text",
  embedDim: 768,
}
CONF
  echo "=== Generated config at $CONFIG ==="
  echo "Dev token:   $DEV_TOKEN"
  echo "Admin token: $ADMIN_TOKEN"
  echo "===================================="
fi

exec deno run \
  --allow-net --allow-read --allow-write --allow-env \
  --allow-import --allow-ffi \
  main.ts --config "$CONFIG" server run
