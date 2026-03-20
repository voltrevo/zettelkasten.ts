FROM ubuntu:24.04

ARG TARGETARCH
ARG DIFFTASTIC_VERSION=0.63.0
ARG YQ_VERSION=4.44.6
ARG NODE_MAJOR=22

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# ============================================================
# System packages (single layer)
# ============================================================
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build tools
    build-essential cmake pkg-config autoconf automake libtool \
    # Python
    python3 python3-pip python3-venv python3-dev \
    # Go
    golang-go \
    # Version control
    git git-lfs \
    # CLI essentials
    jq curl wget unzip zip \
    htop tmux vim-tiny less tree file man-db \
    # Networking / SSH / firewall
    openssh-server iproute2 iputils-ping \
    ca-certificates gnupg \
    # Modern CLI tools (Ubuntu 24.04 repos)
    ripgrep fd-find bat \
    # System
    sudo locales \
    && rm -rf /var/lib/apt/lists/*

# ============================================================
# Node.js via NodeSource
# ============================================================
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ============================================================
# GitHub CLI
# ============================================================
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# ============================================================
# Rust (system-wide via rustup)
# ============================================================
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH="/usr/local/cargo/bin:${PATH}"
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile default \
    && chmod -R a+rX /usr/local/rustup /usr/local/cargo \
    && echo 'export PATH="/usr/local/cargo/bin:$PATH"' > /etc/profile.d/rust.sh

# ============================================================
# difftastic (not in Ubuntu repos)
# ============================================================
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "aarch64" || echo "x86_64") && \
    curl -fsSL "https://github.com/Wilfred/difftastic/releases/download/${DIFFTASTIC_VERSION}/difft-${ARCH}-unknown-linux-gnu.tar.gz" \
    | tar xz -C /usr/local/bin/

# ============================================================
# yq
# ============================================================
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") && \
    curl -fsSL "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_${ARCH}" \
    -o /usr/local/bin/yq && chmod +x /usr/local/bin/yq

# ============================================================
# Claude Code
# ============================================================
RUN npm install -g @anthropic-ai/claude-code

# ============================================================
# Symlinks for Ubuntu-renamed tools
# ============================================================
RUN ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && ln -sf /usr/bin/batcat /usr/local/bin/bat

# ============================================================
# Sandbox user
# ============================================================
RUN useradd -m -s /bin/bash -G sudo claude \
    && echo "claude ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/claude \
    && chmod 440 /etc/sudoers.d/claude

# ============================================================
# SSH server
# ============================================================
RUN mkdir -p /run/sshd \
    && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config \
    && sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
    && echo "PermitRootLogin no" >> /etc/ssh/sshd_config \
    && echo "X11Forwarding no" >> /etc/ssh/sshd_config \
    && echo "AllowUsers claude" >> /etc/ssh/sshd_config

# ============================================================
# Workspace, Claude config, and CLAUDE.md
# ============================================================
RUN mkdir -p /home/claude/workspace /home/claude/.claude

COPY claude-settings.json /home/claude/.claude/settings.json
COPY sandbox-CLAUDE.md /tmp/sandbox-CLAUDE.md
RUN sed '/^<!-- DO NOT INTERPRET/,/-->/d' /tmp/sandbox-CLAUDE.md > /home/claude/workspace/CLAUDE.md \
    && rm /tmp/sandbox-CLAUDE.md
RUN chown -R claude:claude /home/claude

# ============================================================
# Entrypoint
# ============================================================
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /home/claude/workspace
EXPOSE 22

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
