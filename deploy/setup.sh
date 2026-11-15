#!/usr/bin/env bash
# Run once on a fresh Ubuntu 22.04 or 24.04 Vultr server, as root:
#   bash setup.sh
# Installs Node 22 and Caddy, runs ARIA as a service on localhost, and
# puts Caddy in front with an automatic HTTPS certificate. No domain needed:
# it uses <ip>.sslip.io, which resolves to the server's own address.

set -euo pipefail

APP=/opt/aria
IP=$(curl -fsS https://api.ipify.org)
HOSTNAME="${ARIA_HOST:-${IP//./-}.sslip.io}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw

# Node 22
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

# Caddy
if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sed 's#^deb #deb [signed-by=/usr/share/keyrings/caddy.gpg] #' > /etc/apt/sources.list.d/caddy.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi

# App (files were copied to $APP by deploy.sh)
id aria >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin aria
chown -R aria:aria "$APP"
[ -f "$APP/.env" ] && chmod 600 "$APP/.env"
for f in "$APP"/service-account*.json "$APP"/*-key.json; do [ -f "$f" ] && chmod 600 "$f"; done || true

cat > /etc/systemd/system/aria.service <<UNIT
[Unit]
Description=ARIA
After=network.target

[Service]
User=aria
WorkingDirectory=$APP
Environment=HOST=127.0.0.1
Environment=PORT=8200
ExecStart=/usr/bin/node $APP/server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$HOSTNAME {
	encode gzip
	reverse_proxy 127.0.0.1:8200 {
		flush_interval -1
	}
}
CADDY

systemctl daemon-reload
systemctl enable --now aria
systemctl restart aria
systemctl reload caddy || systemctl restart caddy

ufw allow OpenSSH >/dev/null
ufw allow 80,443/tcp >/dev/null
ufw --force enable >/dev/null

echo
echo "ARIA is up at https://$HOSTNAME"
echo "(the first request can take a few seconds while the certificate is issued)"
