#!/usr/bin/env bash
# PCC — Add a Proxmox site via WireGuard
#
# Usage:
#   sudo bash add-site.sh --name "Client A" --wg-ip 10.99.0.2
#
# This script:
#   1. Generates a WireGuard key pair for the new site
#   2. Adds a [Peer] block to /etc/wireguard/wg0.conf on this PCC hub
#   3. Prints the exact commands to run on the remote Proxmox host
#   4. Prints the cluster details to paste into PCC admin panel
#
# WireGuard address plan (adjust if you change --wg-ip):
#   10.99.0.1/24  — PCC hub (this server)
#   10.99.0.2/32  — Site 1
#   10.99.0.3/32  — Site 2
#   ... etc

set -euo pipefail

SITE_NAME=""
SITE_WG_IP=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --name)   SITE_NAME="$2";  shift 2 ;;
    --wg-ip)  SITE_WG_IP="$2"; shift 2 ;;
    *) echo "Usage: $0 --name 'Site Name' --wg-ip 10.99.0.X"; exit 1 ;;
  esac
done

[[ -z "$SITE_NAME" || -z "$SITE_WG_IP" ]] && {
  echo "Usage: $0 --name 'Site Name' --wg-ip 10.99.0.X"
  exit 1
}

WG_CONF=/etc/wireguard/wg0.conf

# ── Initialise hub if first site ──────────────────────────
if [[ ! -f "$WG_CONF" ]]; then
  echo "Creating WireGuard hub config (first site)..."
  HUB_PRIVATE=$(wg genkey)
  HUB_PUBLIC=$(echo "$HUB_PRIVATE" | wg pubkey)
  mkdir -p /etc/wireguard
  chmod 700 /etc/wireguard
  cat > "$WG_CONF" << EOF
[Interface]
PrivateKey = ${HUB_PRIVATE}
Address    = 10.99.0.1/24
ListenPort = 51820
# PostUp   = ufw allow 51820/udp
EOF
  chmod 600 "$WG_CONF"
  systemctl enable wg-quick@wg0
fi

# ── Generate key pair for this new peer ───────────────────
PEER_PRIVATE=$(wg genkey)
PEER_PUBLIC=$(echo "$PEER_PRIVATE" | wg pubkey)

# ── Add peer to hub config ────────────────────────────────
cat >> "$WG_CONF" << EOF

# ${SITE_NAME} — ${SITE_WG_IP}
[Peer]
PublicKey  = ${PEER_PUBLIC}
AllowedIPs = ${SITE_WG_IP}/32
EOF

# Apply without full restart (or start if not running)
if systemctl is-active wg-quick@wg0 &>/dev/null; then
  wg addconf wg0 <(echo -e "[Peer]\nPublicKey = ${PEER_PUBLIC}\nAllowedIPs = ${SITE_WG_IP}/32")
  echo "WireGuard: peer added live."
else
  wg-quick up wg0
  echo "WireGuard: interface started."
fi

HUB_PUBLIC=$(wg show wg0 public-key)
PCC_PUBLIC_IP=$(curl -s --max-time 5 https://ifconfig.me || echo "<PCC_PUBLIC_IP>")

# ── Open firewall port if ufw is active ───────────────────
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 51820/udp comment "WireGuard PCC hub" &>/dev/null || true
  echo "ufw: allowed UDP 51820."
fi

echo ""
echo "================================================================="
echo "  Site added: ${SITE_NAME} (${SITE_WG_IP})"
echo "================================================================="
echo ""
echo "--- Run these commands on the Proxmox host at ${SITE_NAME} ---"
echo ""
echo "apt install -y wireguard"
echo ""
echo "cat > /etc/wireguard/wg0.conf << 'WGEOF'"
echo "[Interface]"
echo "PrivateKey = ${PEER_PRIVATE}"
echo "Address    = ${SITE_WG_IP}/24"
echo ""
echo "[Peer]  # PCC hub"
echo "PublicKey           = ${HUB_PUBLIC}"
echo "Endpoint            = ${PCC_PUBLIC_IP}:51820"
echo "AllowedIPs          = 10.99.0.1/32"
echo "PersistentKeepalive = 25"
echo "WGEOF"
echo ""
echo "chmod 600 /etc/wireguard/wg0.conf"
echo "systemctl enable --now wg-quick@wg0"
echo ""
echo "--- Then create a PVE API token for PCC ---"
echo "  # In Proxmox web UI:"
echo "  #   Datacenter → API Tokens → Add"
echo "  #   User: root@pam  Token ID: pcc  Privilege Separation: No"
echo "  #   Copy the token secret shown (only displayed once)"
echo ""
echo "--- Then add the cluster in PCC Admin → Clusters ---"
echo "  Name      : ${SITE_NAME}"
echo "  Host      : https://${SITE_WG_IP}:8006"
echo "  Auth type : API Token"
echo "  Token     : PVEAPIToken=root@pam!pcc=<paste-your-token-secret>"
echo ""
echo "================================================================="
