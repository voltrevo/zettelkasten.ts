FROM ubuntu:24.04

ARG TARGETARCH
ARG FRP_VERSION=0.67.0

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    squid curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# frpc (fast reverse proxy client)
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") && \
    curl -fsSL "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${ARCH}.tar.gz" \
    | tar xz --strip-components=1 -C /usr/local/bin/ "frp_${FRP_VERSION}_linux_${ARCH}/frpc"

COPY squid.conf /etc/squid/squid.conf
COPY allowed_domains.txt /etc/squid/allowed_domains.txt
COPY gateway-entrypoint.sh /usr/local/bin/gateway-entrypoint.sh
RUN chmod +x /usr/local/bin/gateway-entrypoint.sh

RUN mkdir -p /var/log/squid /tmp/squid \
    && chown -R proxy:proxy /var/log/squid /tmp/squid \
    && squid -z -N -f /etc/squid/squid.conf 2>&1

EXPOSE 3128

ENTRYPOINT ["/usr/local/bin/gateway-entrypoint.sh"]
