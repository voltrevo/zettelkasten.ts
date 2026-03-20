#!/usr/bin/env bash
set -euo pipefail

log() { echo "[gateway] $(date '+%H:%M:%S') $*"; }

# ============================================================
# 1. Start Squid
# ============================================================
log "Initializing Squid..."
squid -z -N -f /etc/squid/squid.conf 2>&1
squid -N -f /etc/squid/squid.conf &
SQUID_PID=$!

# Tail logs to stdout
tail -F /var/log/squid/access.log /var/log/squid/cache.log 2>/dev/null &

# ============================================================
# 2. Start frpc (if configured)
# ============================================================
FRP_SERVER_ADDR="${FRP_SERVER_ADDR:-}"
FRP_AUTH_TOKEN="${FRP_AUTH_TOKEN:-}"
FRP_REMOTE_PORT="${FRP_REMOTE_PORT:-}"
FRP_SERVER_PORT="${FRP_SERVER_PORT:-7000}"
SANDBOX_HOST="${SANDBOX_HOST:-sandbox}"

FRPC_PID=""
if [ -n "$FRP_SERVER_ADDR" ] && [ -n "$FRP_AUTH_TOKEN" ] && [ -n "$FRP_REMOTE_PORT" ]; then
    log "Generating frpc configuration..."
    cat > /tmp/frpc.toml <<FRPCEOF
serverAddr = "${FRP_SERVER_ADDR}"
serverPort = ${FRP_SERVER_PORT}
auth.method = "token"
auth.token = "${FRP_AUTH_TOKEN}"

[[proxies]]
name = "ssh-${HOSTNAME}"
type = "tcp"
localIP = "${SANDBOX_HOST}"
localPort = 22
remotePort = ${FRP_REMOTE_PORT}
FRPCEOF

    log "Starting frpc (remote port ${FRP_REMOTE_PORT})..."
    /usr/local/bin/frpc -c /tmp/frpc.toml &
    FRPC_PID=$!
else
    log "frpc not configured, skipping."
fi

# ============================================================
# 3. Signal handling and wait
# ============================================================
cleanup() {
    log "Shutting down..."
    kill "$SQUID_PID" 2>/dev/null || true
    [ -n "$FRPC_PID" ] && kill "$FRPC_PID" 2>/dev/null || true
    wait
    exit 0
}
trap cleanup SIGTERM SIGINT

log "Gateway ready."
wait
