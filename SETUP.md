# PCC — Proxmox Command Center
## Standalone Server Setup Guide

This guide sets up PCC on a **dedicated Debian 12 VM** — the recommended production deployment.
In standalone mode PCC runs 24/7 as a Node.js service, connects to all your Proxmox clusters
via stored API tokens, and handles team login, shared settings, scheduled operations and webhooks.

> **Direct mode** (served from the Proxmox host itself on port 8080) still works and needs no
> extra VM — it is covered at the bottom of this doc. Use standalone when you manage multiple
> clusters or need multi-user access.

---

## Prerequisites

| Item | Requirement |
|---|---|
| **PCC Debian VM** | Debian 12 (Bookworm), 1 vCPU, 512 MB RAM, 10 GB disk — minimal install |
| **Public domain** | A subdomain pointing at the VM's IP (e.g. `pcc.certus.je`) |
| **Port 80 & 443** | Reachable from the internet for Let's Encrypt certificate issuance |
| **Port 51820/UDP** | Open inbound for WireGuard (only needed when connecting remote Proxmox hosts) |
| **Git repo** | `https://github.com/bclaremont/proxmox-dashboard` — the source of all files |

---

## Step 1 — Create the Debian 12 VM

In your Proxmox web UI:

1. **Create VM** — use the Debian 12 net-install ISO (or a cloud image)
2. **Recommended spec:** 1 vCPU · 1 GB RAM · 10 GB disk
3. **Network:** assign a static IP or reserve via DHCP on your router/switch
4. Install Debian with **SSH server** enabled, no desktop environment
5. Note the VM's IP address — you'll need it for the DNS record

---

## Step 2 — DNS record

Create an **A record** pointing your chosen subdomain to the VM's IP:

```
pcc.certus.je  →  192.168.x.x   (or your public IP if internet-facing)
```

If the VM is behind NAT, forward **ports 80 and 443** from your router to the VM before
running the setup script (Let's Encrypt needs port 80 to issue the certificate).

Wait a minute or two for DNS to propagate, then verify:

```bash
dig +short pcc.certus.je
```

---

## Step 3 — Get PCC files onto the Debian VM

SSH into the new Debian VM, then run:

```bash
# Install git if not present
apt install -y git

# Clone the repo
git clone https://github.com/bclaremont/proxmox-dashboard.git /tmp/pcc-src

# Copy server files to /opt/pcc
mkdir -p /opt/pcc/public /opt/pcc/data

cp /tmp/pcc-src/server/server.js       /opt/pcc/server.js
cp /tmp/pcc-src/server/package.json    /opt/pcc/package.json
cp /tmp/pcc-src/server/setup.sh        /opt/pcc/setup.sh
cp /tmp/pcc-src/server/add-site.sh     /opt/pcc/add-site.sh

cp /tmp/pcc-src/proxmox-dashboard.html /opt/pcc/public/index.html
cp /tmp/pcc-src/console.html           /opt/pcc/public/console.html

chmod +x /opt/pcc/setup.sh /opt/pcc/add-site.sh

# Clean up
rm -rf /tmp/pcc-src
```

**Alternative — copy from your existing Proxmox host** (if you prefer not to use GitHub):

```bash
# Run this FROM the Proxmox host, replacing PCC_VM_IP with the Debian VM's IP
PCC_VM_IP=192.168.x.x

ssh root@$PCC_VM_IP "mkdir -p /opt/pcc/public /opt/pcc/data"
scp /opt/proxmox-dashboard/server/server.js     root@$PCC_VM_IP:/opt/pcc/server.js
scp /opt/proxmox-dashboard/server/package.json  root@$PCC_VM_IP:/opt/pcc/package.json
scp /opt/proxmox-dashboard/server/setup.sh      root@$PCC_VM_IP:/opt/pcc/setup.sh
scp /opt/proxmox-dashboard/server/add-site.sh   root@$PCC_VM_IP:/opt/pcc/add-site.sh
scp /opt/proxmox-dashboard/proxmox-dashboard.html  root@$PCC_VM_IP:/opt/pcc/public/index.html
scp /opt/proxmox-dashboard/console.html            root@$PCC_VM_IP:/opt/pcc/public/console.html
ssh root@$PCC_VM_IP "chmod +x /opt/pcc/setup.sh /opt/pcc/add-site.sh"
```

---

## Step 4 — Run the setup script

Back on the **Debian VM**:

```bash
cd /opt/pcc
sudo bash setup.sh --domain pcc.certus.je --email bart@certus.je
```

Or to set your admin password upfront:

```bash
sudo bash setup.sh --domain pcc.certus.je --email bart@certus.je --admin-pw MySecretPassword
```

The script will:
1. Install **nginx**, **Node.js 20**, **certbot**, **WireGuard**, build tools
2. Run `npm install` for the backend dependencies
3. Obtain a **Let's Encrypt TLS certificate** for your domain
4. Configure **nginx** as an HTTPS reverse proxy to the Node.js backend
5. Create a **systemd service** (`pcc.service`) and enable it to start on boot
6. Print your admin credentials

At the end you'll see:

```
===================================
  PCC is now running!

  URL:   https://pcc.certus.je
  User:  admin
  Pass:  <generated or your password>
===================================
```

---

## Step 5 — First login and change password

1. Open `https://pcc.certus.je` in your browser
2. Log in with `admin` and the password shown after setup
3. Go to **Admin → PCC Admin → My Account → Change Password** and set a strong password
4. Optionally add team members under **Admin → PCC Admin → Users**

---

## Step 6 — Create a Proxmox API token

Do this on **each Proxmox cluster** you want to manage.

In the **Proxmox web UI** (`https://your-pve-host:8006`):

1. Go to **Datacenter → API Tokens → Add**
2. Fill in:
   - **User:** `root@pam`
   - **Token ID:** `pcc`
   - **Privilege Separation:** ☐ (unchecked — PCC needs full access)
3. Click **Add**
4. **Copy the token secret** shown — it is only displayed once

The token will look like:
```
PVEAPIToken=root@pam!pcc=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

---

## Step 7 — Add your first cluster

In PCC, go to **Admin → PCC Admin → Clusters → + Add Cluster**:

| Field | Value |
|---|---|
| **Name** | `Production` (or whatever you call this cluster) |
| **Host URL** | `https://192.168.1.10:8006` (direct PVE API — see note below) |
| **Auth type** | API Token |
| **Token** | Paste the full `PVEAPIToken=root@pam!pcc=…` string |
| **Sort order** | `0` (primary cluster) |

> **Host URL options:**
> - **Same LAN as PCC VM:** use `https://pve-ip:8006` directly — the PCC server can reach it
> - **Remote site:** use the WireGuard IP (see Step 8) — `https://10.99.0.x:8006`
> - The PCC backend proxies all API calls server-side, so the browser never connects to Proxmox directly

Click **Add**, then **sign out and back in** — PCC will auto-connect on login.

---

## Step 8 — Add a remote site via WireGuard

For Proxmox clusters at **different locations** (client sites, remote DCs), use WireGuard so the
PCC server can reach them securely without exposing the Proxmox API to the internet.

On the **PCC Debian VM**, run:

```bash
sudo bash /opt/pcc/add-site.sh --name "Client A" --wg-ip 10.99.0.2
```

The script will:
1. Generate a WireGuard key pair for this site
2. Add a `[Peer]` entry to `/etc/wireguard/wg0.conf` on the PCC hub
3. Print the exact commands to run on the remote Proxmox host

The output looks like:

```
=== Run these commands on the Proxmox host at Client A ===

  apt install -y wireguard

  cat > /etc/wireguard/wg0.conf << 'WGEOF'
  [Interface]
  PrivateKey = <generated>
  Address    = 10.99.0.2/24

  [Peer]  # PCC hub
  PublicKey           = <hub-pubkey>
  Endpoint            = pcc.certus.je:51820
  AllowedIPs          = 10.99.0.1/32
  PersistentKeepalive = 25
  WGEOF

  chmod 600 /etc/wireguard/wg0.conf
  systemctl enable --now wg-quick@wg0

=== Then add the cluster in PCC Admin → Clusters ===
  Name  : Client A
  Host  : https://10.99.0.2:8006
  Token : PVEAPIToken=root@pam!pcc=<your-token>
```

Repeat for each additional site, incrementing the WireGuard IP:
- Site 1 → `--wg-ip 10.99.0.2`
- Site 2 → `--wg-ip 10.99.0.3`
- Site 3 → `--wg-ip 10.99.0.4`
- etc.

---

## Step 9 — Add team members

Go to **Admin → PCC Admin → Users → + Add User**:

| Field | Note |
|---|---|
| Username | e.g. `alice` |
| Password | Min 8 characters — user should change on first login |
| Role | `admin` = full access · `user` = view + operate, no cluster/user management |

Each team member logs into `https://pcc.certus.je` with their own credentials.
All shared settings (host profiles, affinity rules, saved views, scheduled jobs) sync across the team automatically.

---

## Ongoing operations

### Check PCC service status
```bash
systemctl status pcc
journalctl -u pcc -f          # live logs
```

### Restart after config change
```bash
systemctl restart pcc
```

### Update PCC to latest version
```bash
# On the PCC VM
git clone https://github.com/bclaremont/proxmox-dashboard.git /tmp/pcc-update

cp /tmp/pcc-update/server/server.js       /opt/pcc/server.js
cp /tmp/pcc-update/server/package.json    /opt/pcc/package.json
cp /tmp/pcc-update/proxmox-dashboard.html /opt/pcc/public/index.html
cp /tmp/pcc-update/console.html           /opt/pcc/public/console.html

cd /opt/pcc && npm install --omit=dev
systemctl restart pcc

rm -rf /tmp/pcc-update
```

### TLS certificate renewal
Certbot renews automatically via a systemd timer. To force a renewal:
```bash
certbot renew --force-renewal
systemctl reload nginx
```

### Backup the database
The SQLite database holds all your cluster configs, users, schedules, shared settings:
```bash
cp /opt/pcc/data/pcc.db /opt/pcc/data/pcc.db.bak-$(date +%Y%m%d)
```
For offsite backup, copy `pcc.db` anywhere — it's a single self-contained file.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| PCC won't start | `journalctl -u pcc -n 50` — usually a missing .env or bad JWT_SECRET |
| `502 Bad Gateway` | `systemctl status pcc` — the Node.js process may have crashed |
| Let's Encrypt failed | Verify port 80 is reachable: `curl http://pcc.certus.je` from outside |
| Can't reach Proxmox | Check WireGuard: `wg show` — look for latest handshake time |
| WireGuard no handshake | Port 51820/UDP must be open inbound on the PCC VM |
| Console not working | Browser must be able to reach PCC server; WireGuard tunnel must be up |
| Cluster shows error | Test API token: `curl -k -H "Authorization: PVEAPIToken=..." https://pve:8006/api2/json/version` |

### Key file locations

| File | Purpose |
|---|---|
| `/opt/pcc/.env` | JWT secret, DB path, admin password (readable by root only) |
| `/opt/pcc/data/pcc.db` | SQLite database — all config, users, schedules |
| `/opt/pcc/public/index.html` | PCC dashboard HTML |
| `/etc/nginx/sites-available/pcc` | nginx HTTPS config |
| `/etc/wireguard/wg0.conf` | WireGuard hub config |
| `/etc/letsencrypt/live/pcc.*/` | TLS certificates |

---

## Direct mode (Proxmox host — no separate VM)

If you just want PCC on a single Proxmox host without a dedicated VM, the nginx proxy
approach is already set up at `http://your-pve-ip:8080`. No installation needed — just:

1. Copy `proxmox-dashboard.html` to `/var/www/proxmox-dashboard/index.html`
2. Copy `console.html` to `/var/www/proxmox-dashboard/console.html`
3. Ensure nginx is running: `systemctl status nginx`
4. Open `http://your-pve-ip:8080` and connect with PVE credentials

Limitations of direct mode vs standalone:
- No team login — anyone who can reach port 8080 has access
- Shared settings (profiles, rules, schedules) are browser-local only
- Scheduled operations only run while the browser is open
- No audit log of who did what

---

*PCC is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Proxmox Server Solutions GmbH. Proxmox® and Proxmox VE® are registered trademarks of Proxmox Server Solutions GmbH.*
