#!/usr/bin/env bash
# PCC — Proxmox Command Center
# Standalone Debian setup script
#
# Usage:
#   sudo bash setup.sh --domain pcc.example.com --email admin@example.com
#   sudo bash setup.sh --domain pcc.example.com --email admin@example.com --admin-pw MySecret123
#
# What this does:
#   1. Installs nginx, Node.js 20, certbot, wireguard
#   2. Sets up /opt/pcc with Node dependencies
#   3. Obtains a Let's Encrypt TLS certificate
#   4. Configures nginx as HTTPS reverse proxy → Node.js backend
#   5. Creates a systemd service (pcc.service)
#   6. Prints the admin credentials

set -euo pipefail

DOMAIN=""
EMAIL=""
ADMIN_PW=""

usage() { echo "Usage: $0 --domain pcc.example.com --email you@example.com [--admin-pw password]"; exit 1; }

while [[ $# -gt 0 ]]; do
  case $1 in
    --domain)   DOMAIN="$2";   shift 2 ;;
    --email)    EMAIL="$2";    shift 2 ;;
    --admin-pw) ADMIN_PW="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -z "$DOMAIN" || -z "$EMAIL" ]] && usage

# Generate secrets if not provided
[[ -z "$ADMIN_PW" ]] && ADMIN_PW="$(openssl rand -base64 12 | tr -d '=+/')"
JWT_SECRET="$(openssl rand -base64 48)"

echo "==================================================================="
echo "  PCC Setup — Debian"
echo "  Domain : $DOMAIN"
echo "  Email  : $EMAIL"
echo "==================================================================="

# ── 1. SYSTEM PACKAGES ────────────────────────────────────
echo ""
echo "--- [1/6] Installing packages ---"
apt-get update -q
apt-get install -y -q curl gnupg2 ca-certificates lsb-release

# Node.js 20 via NodeSource
if ! node --version 2>/dev/null | grep -q "^v2[0-9]"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
fi
apt-get install -y -q nodejs nginx certbot python3-certbot-nginx wireguard build-essential

# ── 2. PCC DIRECTORY ──────────────────────────────────────
echo "--- [2/6] Setting up /opt/pcc ---"
mkdir -p /opt/pcc/data /opt/pcc/public

# Copy server files only when running from the repo (not already in /opt/pcc)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$SCRIPT_DIR" != "/opt/pcc" ]]; then
  cp "$SCRIPT_DIR/server.js"    /opt/pcc/server.js
  cp "$SCRIPT_DIR/package.json" /opt/pcc/package.json
  [[ -f "$SCRIPT_DIR/public/index.html" ]] && cp "$SCRIPT_DIR/public/index.html" /opt/pcc/public/index.html
  [[ -d "$SCRIPT_DIR/public/vendor"     ]] && cp -r "$SCRIPT_DIR/public/vendor"  /opt/pcc/public/vendor
fi

# Install pcc-update command
cp "$SCRIPT_DIR/update.sh" /opt/pcc/update.sh 2>/dev/null || true
install -m 755 /opt/pcc/update.sh /usr/local/bin/pcc-update 2>/dev/null || true

# npm install
cd /opt/pcc
npm install --omit=dev --silent

# Create .env (readable only by root / pcc service user)
cat > /opt/pcc/.env << EOF
PORT=3000
JWT_SECRET=${JWT_SECRET}
DB_PATH=/opt/pcc/data/pcc.db
ADMIN_PASSWORD=${ADMIN_PW}
EOF
chmod 640 /opt/pcc/.env

# Dedicated system user
id pcc &>/dev/null || useradd -r -s /bin/false -d /opt/pcc pcc
chown -R pcc:pcc /opt/pcc

# ── 3. LET'S ENCRYPT CERT ─────────────────────────────────
echo "--- [3/6] Obtaining Let's Encrypt certificate for $DOMAIN ---"

# nginx needs to be running for the ACME HTTP-01 challenge
cat > /etc/nginx/sites-available/pcc-certbot << 'EOF'
server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER;
    root /var/www/html;
    location /.well-known/acme-challenge/ { try_files $uri =404; }
    location / { return 301 https://$host$request_uri; }
}
EOF
sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/" /etc/nginx/sites-available/pcc-certbot
ln -sf /etc/nginx/sites-available/pcc-certbot /etc/nginx/sites-enabled/pcc-certbot
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

certbot certonly --nginx \
  -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "$EMAIL" \
  --redirect

rm /etc/nginx/sites-enabled/pcc-certbot

# ── 4. NGINX CONFIG ───────────────────────────────────────
echo "--- [4/6] Configuring nginx ---"
cat > /etc/nginx/sites-available/pcc << EOF
# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};
    http2 on;

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options            SAMEORIGIN                             always;
    add_header X-Content-Type-Options     nosniff                                always;
    add_header Referrer-Policy            strict-origin-when-cross-origin        always;

    # All traffic → Node.js backend (which serves static HTML + API + proxy)
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   Upgrade           \$http_upgrade;
        proxy_set_header   Connection        "upgrade";

        # Allow large ISO uploads through the proxy
        client_max_body_size    50G;
        proxy_buffering         off;
        proxy_request_buffering off;
        proxy_read_timeout      3600s;
        proxy_send_timeout      3600s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/pcc /etc/nginx/sites-enabled/pcc
rm -f /etc/nginx/sites-enabled/pcc-certbot
nginx -t && systemctl reload nginx

# ── 5. SYSTEMD SERVICE ────────────────────────────────────
echo "--- [5/6] Creating systemd service ---"
cat > /etc/systemd/system/pcc.service << EOF
[Unit]
Description=PCC — Proxmox Command Center
Documentation=https://github.com/your-org/pcc
After=network.target

[Service]
Type=simple
User=pcc
Group=pcc
WorkingDirectory=/opt/pcc
EnvironmentFile=/opt/pcc/.env
ExecStart=/usr/bin/node /opt/pcc/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pcc
systemctl start pcc

# ── 6. AUTO-RENEWAL ───────────────────────────────────────
echo "--- [6/6] Enabling Let's Encrypt auto-renewal ---"
systemctl enable certbot.timer 2>/dev/null || true
# Post-renewal hook to reload nginx
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh << 'EOF'
#!/bin/sh
systemctl reload nginx
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

# ── DONE ──────────────────────────────────────────────────
echo ""
echo "==================================================================="
echo "  PCC is running!"
echo ""
echo "  URL      : https://${DOMAIN}"
echo "  Username : admin"
echo "  Password : ${ADMIN_PW}"
echo ""
echo "  IMPORTANT: Change the admin password on first login."
echo ""
echo "  To add a Proxmox site via WireGuard:"
echo "    sudo bash add-site.sh --name 'Site A' --wg-ip 10.99.0.2"
echo "==================================================================="
