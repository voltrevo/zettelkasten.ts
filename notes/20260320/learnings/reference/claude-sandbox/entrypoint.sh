#!/usr/bin/env bash
set -euo pipefail

log() { echo "[entrypoint] $(date '+%H:%M:%S') $*"; }

# ============================================================
# 1. Validate required environment variables
# ============================================================
: "${SSH_AUTHORIZED_KEYS:?SSH_AUTHORIZED_KEYS is required}"
GATEWAY_IP="${GATEWAY_IP:-172.28.0.2}"
GATEWAY_PORT="${GATEWAY_PORT:-3128}"

USER_HOME="/home/claude"

# ============================================================
# 2. Fix volume ownership
# ============================================================
log "Fixing volume ownership..."
chown -R claude:claude "${USER_HOME}/workspace"
mkdir -p "${USER_HOME}/.claude"
chown -R claude:claude "${USER_HOME}/.claude"

# ============================================================
# 3. SSH setup
# ============================================================
if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
    log "Generating SSH host keys..."
    ssh-keygen -A
fi

mkdir -p "${USER_HOME}/.ssh"
echo -e "${SSH_AUTHORIZED_KEYS}" > "${USER_HOME}/.ssh/authorized_keys"
chmod 700 "${USER_HOME}/.ssh"
chmod 600 "${USER_HOME}/.ssh/authorized_keys"
chown -R claude:claude "${USER_HOME}/.ssh"

# ============================================================
# 4. User environment (API key + proxy config)
# ============================================================
log "Configuring user environment..."

PROXY_URL="http://${GATEWAY_IP}:${GATEWAY_PORT}"

# Profile.d for login shells (SSH sessions)
cat > /etc/profile.d/claude-env.sh <<ENVEOF
export http_proxy='${PROXY_URL}'
export https_proxy='${PROXY_URL}'
export HTTP_PROXY='${PROXY_URL}'
export HTTPS_PROXY='${PROXY_URL}'
export no_proxy='localhost,127.0.0.1'
export NO_PROXY='localhost,127.0.0.1'
ENVEOF
chmod 644 /etc/profile.d/claude-env.sh

# Bashrc for non-login shells
cat >> "${USER_HOME}/.bashrc" <<RCEOF

# Claude sandbox environment
export http_proxy='${PROXY_URL}'
export https_proxy='${PROXY_URL}'
export HTTP_PROXY='${PROXY_URL}'
export HTTPS_PROXY='${PROXY_URL}'
export no_proxy='localhost,127.0.0.1'
export NO_PROXY='localhost,127.0.0.1'
RCEOF
chown claude:claude "${USER_HOME}/.bashrc"

# Apt proxy configuration
cat > /etc/apt/apt.conf.d/proxy.conf <<APTEOF
Acquire::http::Proxy "${PROXY_URL}";
Acquire::https::Proxy "${PROXY_URL}";
APTEOF

# Git proxy configuration
git config --system http.proxy "${PROXY_URL}"
git config --system https.proxy "${PROXY_URL}"

# ============================================================
# 5. Start sshd
# ============================================================
log "Starting sshd..."
/usr/sbin/sshd -D &
SSHD_PID=$!

# ============================================================
# 6. Signal handling and wait
# ============================================================
cleanup() {
    log "Shutting down..."
    kill "$SSHD_PID" 2>/dev/null || true
    wait
    exit 0
}
trap cleanup SIGTERM SIGINT

log "Sandbox ready. Network enforced by Docker (internal network)."
wait
