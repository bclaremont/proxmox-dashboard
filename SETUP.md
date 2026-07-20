# PCC
## Setup Guide

**PCC** is an open-source, browser-based management dashboard for
Proxmox VE. It goes beyond the standard Proxmox web UI to give you a single pane of glass
across multiple clusters and standalone hosts — whether they're on the same LAN or spread
across different client sites.

Out of the box PCC gives you:

- **Unified fleet view** — all your VMs, containers, nodes and storage across every connected
  cluster in one interface, with live resource gauges, heatmaps and cluster graphs
- **Automation** — scheduled VM operations, DRS (compute and storage), affinity rules,
  capacity forecasting, and host profile compliance checks
- **Content Library** — manage VM templates with metadata, customisation specs, and one-click
  deploy with automatic cloud-init configuration
- **Team features** — per-user logins, shared settings, webhooks, audit log, and scheduled
  reports (standalone mode)
- **Advanced fleet management** — maintenance drain, affinity/anti-affinity rules, storage
  DRS, per-VM alerts, VM customisation specs, host profiles, scheduled operations, and more — all free and open source

PCC is a single HTML file at its core, served by either a lightweight Node.js backend
(standalone mode) or directly from a Proxmox host via nginx (direct mode). There is no
database to manage beyond a single SQLite file, no Docker, no Kubernetes, no fuss.

> PCC is an independent open-source project and is not affiliated with, endorsed by, or
> sponsored by Proxmox Server Solutions GmbH. Proxmox® and Proxmox VE® are registered
> trademarks of Proxmox Server Solutions GmbH.

---

PCC can be deployed in two ways. Choose the one that fits your situation:

| | **Standalone VM** ✅ Recommended | **Direct mode** |
|---|---|---|
| **What it is** | PCC runs on its own Debian VM with a Node.js backend | PCC runs on a Proxmox host, served by nginx |
| **Separate VM needed** | Yes — any Debian VM (1 vCPU, 512 MB RAM, 10 GB) | No |
| **nginx** | ✅ Installed automatically by `setup.sh` | ❌ Must install and configure manually |
| **Node.js backend** | ✅ Installed automatically by `setup.sh` | ❌ Not used |
| **HTTPS / TLS cert** | ✅ Let's Encrypt, automatic renewal | ❌ Plain HTTP on port 8080 (no cert) |
| **Setup effort** | One command: `bash setup.sh --domain … --email …` | ~6 manual steps |
| **Team logins** | ✅ Yes — per-user accounts with roles | ❌ No — anyone who can reach port 8080 has access |
| **Multi-cluster** | ✅ Yes — all clusters through one URL | ⚠ Only the local PVE host by default |
| **Scheduled jobs** | ✅ Run 24/7 server-side | ❌ Only while browser is open |
| **Shared settings** | ✅ Synced across team via SQLite | ❌ Browser-local only |
| **Best for** | Teams, multiple client sites, production use | Quick single-host testing or personal use |

> **Not sure?** Go standalone — it's actually less work to set up.

---

## Part A — Standalone VM Setup

### Prerequisites

| Item | Requirement |
|---|---|
| **Debian VM** | Any current Debian release, 1 vCPU, 512 MB RAM, 10 GB disk — minimal install |
| **Public domain** | A subdomain pointing at the VM's IP (e.g. `pcc.yourdomain.com`) |
| **Port 80 & 443** | Reachable from the internet for Let's Encrypt certificate issuance |
| **Port 51820/UDP** | Open inbound for WireGuard (only needed when connecting remote Proxmox hosts) |
| **Git repo** | `https://github.com/bclaremont/proxmox-dashboard` — the source of all files |

---

## Step 1 — Create the Debian VM

In your Proxmox web UI:

1. **Create VM** — use the Debian net-install ISO (or a cloud image)
2. **Recommended spec:** 1 vCPU · 1 GB RAM · 10 GB disk
3. **Network:** assign a static IP or reserve via DHCP on your router/switch
4. Install Debian with **SSH server** enabled, no desktop environment
5. Note the VM's IP address — you'll need it for the DNS record

---

## Step 2 — Harden the server

Run these on the **Debian VM** immediately after first login. Takes about 2 minutes.

```bash
# Update everything first
apt update && apt upgrade -y
```

### Firewall (UFW)

Only open the ports PCC actually needs:

```bash
apt install -y ufw

ufw default deny incoming
ufw default allow outgoing
ufw allow ssh          # port 22  — SSH access
ufw allow 80/tcp       # port 80  — Let's Encrypt certificate challenges
ufw allow 443/tcp      # port 443 — PCC HTTPS
ufw allow 51820/udp    # port 51820 — WireGuard (remote Proxmox sites)

ufw --force enable
ufw status
```

> If you're not using WireGuard (no remote sites), skip `ufw allow 51820/udp`.

### fail2ban

Bans IPs that repeatedly fail SSH (or other services):

```bash
apt install -y fail2ban

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime  = 3600    # ban for 1 hour
findtime = 600     # within a 10-minute window
maxretry = 5       # after 5 failures

[sshd]
enabled = true
port    = ssh
EOF

systemctl enable fail2ban
systemctl restart fail2ban

# Check it's running
fail2ban-client status
```

### Automatic security updates

```bash
apt install -y unattended-upgrades

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
```

Security patches will now apply automatically overnight without requiring a reboot for most updates.

### SSH keys (optional but recommended)

If you're accessing this server regularly, switch to key-based SSH authentication:

```bash
# On your LOCAL machine — generate a key if you don't have one
ssh-keygen -t ed25519 -C "pcc-server"

# Copy your public key to the server
ssh-copy-id root@PCC_VM_IP

# Then on the SERVER — disable password login
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

> ⚠ Make sure you can log in with your key **before** disabling password auth, or you'll lock yourself out.

### AppArmor

AppArmor is already installed on Debian but may not be active. Enabling it enforces mandatory
access control profiles on system services — nginx in particular has a well-tested profile that
limits what it can read, write and execute.

```bash
apt install -y apparmor apparmor-utils apparmor-profiles apparmor-profiles-extra

systemctl enable apparmor
systemctl start apparmor

# Check status — should show profiles in enforce mode
aa-status
```

After the PCC setup is complete and nginx is running, confirm its profile is enforcing:

```bash
aa-status | grep nginx
# Should show: /usr/sbin/nginx (enforce)
```

> **What about the PCC Node.js backend?**
> Writing a tight AppArmor profile for a Node.js application that makes outbound connections
> to Proxmox hosts on dynamic IPs and ports is non-trivial. Getting it wrong causes silent
> failures that are hard to debug. The backend runs as a dedicated `pcc` system user with
> no shell and no login, which already limits its blast radius. A custom profile is possible
> but is an advanced step beyond the scope of this guide. UFW + fail2ban + the `pcc` system
> user provides a solid baseline for most deployments.

---

## Step 3 — DNS record

Create an **A record** pointing your chosen subdomain to the VM's IP:

```
pcc.yourdomain.com  →  192.168.x.x   (or your public IP if internet-facing)
```

If the VM is behind NAT, forward **ports 80 and 443** from your router to the VM before
running the setup script (Let's Encrypt needs port 80 to issue the certificate).

Wait a minute or two for DNS to propagate, then verify:

```bash
dig +short pcc.yourdomain.com
```

---

## Step 4 — Get PCC files onto the Debian VM

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
cp -r /tmp/pcc-src/vendor              /opt/pcc/public/vendor

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
scp -r /opt/proxmox-dashboard/vendor               root@$PCC_VM_IP:/opt/pcc/public/vendor
ssh root@$PCC_VM_IP "chmod +x /opt/pcc/setup.sh /opt/pcc/add-site.sh"
```

---

## Step 5 — Run the setup script

Back on the **Debian VM**:

```bash
cd /opt/pcc
sudo bash setup.sh --domain pcc.yourdomain.com --email you@yourdomain.com
```

Or to set your admin password upfront:

```bash
sudo bash setup.sh --domain pcc.yourdomain.com --email you@yourdomain.com --admin-pw MySecretPassword
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

  URL:   https://pcc.yourdomain.com
  User:  admin
  Pass:  <generated or your password>
===================================
```

---

## Step 6 — First login and change password

1. Open `https://pcc.yourdomain.com` in your browser
2. Log in with `admin` and the password shown after setup
3. Go to **Admin → PCC Admin → My Account → Change Password** and set a strong password
4. Optionally add team members under **Admin → PCC Admin → Users**

---

## Step 7 — Create a Proxmox API token

Do this on **each Proxmox cluster** you want to manage.

In the **Proxmox web UI** (`https://your-pve-host:8006`):

1. Go to **Datacenter → API Tokens → Add**
2. Fill in:
   - **User:** `root@pam`
   - **Token ID:** `pcc`
   - **Privilege Separation:** ☐ (unchecked — PCC needs full access)
3. Click **Add**
4. **Copy the token secret** shown — it is only displayed once

> ⚠️ **The Proxmox UI shows the full token string once and never again. Copy it immediately.**

The token is a single string in this exact format — paste it exactly as shown, including the `PVEAPIToken=` prefix:

```
PVEAPIToken=root@pam!pcc=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
│            │        │   │
│            │        │   └─ Secret UUID (shown after you click Add)
│            │        └───── Token ID you chose (e.g. pcc)
│            └────────────── Proxmox user
└─────────────────────────── Literal prefix — must be included
```

Common mistakes: missing the `PVEAPIToken=` prefix · missing the `!` between user and token ID · pasting only the UUID secret.

---

## Step 8 — Add your first cluster

In PCC, go to **Admin → PCC Admin → Clusters → + Add Cluster**:

| Field | Value |
|---|---|
| **Name** | `Production` (or whatever you call this cluster) |
| **Host URL** | `https://192.168.1.10:8006` (your PVE host IP, port 8006) |
| **Auth type** | API Token |
| **Token** | Paste the **complete** string: `PVEAPIToken=root@pam!pcc=xxxxxxxx-…` |
| **Sort order** | `0` (primary cluster) |

> **Host URL options:**
> - **Same LAN as PCC VM:** use `https://pve-ip:8006` directly — the PCC server can reach it
> - **Remote site:** use the WireGuard IP (see Step 8) — `https://10.99.0.x:8006`
> - The PCC backend proxies all API calls server-side, so the browser never connects to Proxmox directly

Click **Add**, then **sign out and back in** — PCC will auto-connect on login.

---

## Step 9 — Add a remote site via WireGuard

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
# Allow PCC hub to reach Proxmox API (only if Proxmox host firewall is DISABLED)
# If the Proxmox firewall IS enabled, add this rule via Datacenter → Firewall instead
PostUp     = iptables -I INPUT -s 10.99.0.1/32 -p tcp --dport 8006 -j ACCEPT
PreDown    = iptables -D INPUT -s 10.99.0.1/32 -p tcp --dport 8006 -j ACCEPT

[Peer]  # PCC hub
PublicKey           = <hub-pubkey>
Endpoint            = pcc.yourdomain.com:51820
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

### High availability for multi-node remote clusters

**The problem:** If a remote site is a Proxmox cluster (multiple nodes) and you connect PCC
to a single node, losing that node loses PCC visibility for the whole cluster — even though
the other nodes are healthy.

**The solution:** Use `keepalived` so the WireGuard tunnel automatically moves to another
node if the primary goes down. PCC always connects to the same WireGuard IP and never
notices the failover.

**How it works:** All nodes in the cluster share the same WireGuard private key and IP.
`keepalived` decides which node is active. Only one node runs WireGuard at a time. When the
active node fails, keepalived promotes a backup and WireGuard starts there automatically.

#### Setup (run on every node in the remote cluster)

**1. Install keepalived on all nodes:**
```bash
apt install -y keepalived
```

**2. Copy the same `wg0.conf` to all nodes** — use the config generated by `add-site.sh`.
The same private key and WireGuard IP goes on every node. This is intentional.

**3. Create `/etc/keepalived/keepalived.conf` on each node:**

On the **primary node** (highest priority, becomes master first):
```conf
vrrp_instance PCC_WG {
    state MASTER
    interface vmbr0          # adjust to your LAN interface
    virtual_router_id 51     # must match on all nodes, unique per cluster
    priority 100             # highest = first master
    advert_int 1
    nopreempt
    authentication {
        auth_type PASS
        auth_pass changeme   # change to a shared secret, same on all nodes
    }
    notify_master "/usr/bin/wg-quick down wg0 2>/dev/null; /usr/bin/wg-quick up wg0"
    notify_backup "/usr/bin/wg-quick down wg0 2>/dev/null || true"
    notify_fault  "/usr/bin/wg-quick down wg0 2>/dev/null || true"
}
```

On each **backup node** — same config but lower priority and `state BACKUP`:
```conf
vrrp_instance PCC_WG {
    state BACKUP
    interface vmbr0
    virtual_router_id 51
    priority 90              # second node: 90, third node: 80, etc.
    advert_int 1
    nopreempt
    authentication {
        auth_type PASS
        auth_pass changeme
    }
    notify_master "/usr/bin/wg-quick down wg0 2>/dev/null; /usr/bin/wg-quick up wg0"
    notify_backup "/usr/bin/wg-quick down wg0 2>/dev/null || true"
    notify_fault  "/usr/bin/wg-quick down wg0 2>/dev/null || true"
}
```

**4. Do NOT enable wg-quick@wg0 as a systemd service** — keepalived manages WireGuard.
Remove it if already enabled:
```bash
systemctl disable wg-quick@wg0
systemctl stop wg-quick@wg0
```

**5. Enable and start keepalived on all nodes:**
```bash
systemctl enable keepalived
systemctl start keepalived
```

**6. Verify** — on the node that should be master:
```bash
wg show          # should show the wg0 interface
ip addr show wg0 # should show 10.99.0.x
```

On the backup nodes, `wg show` should show nothing (WireGuard not running there).

**7. In PCC Admin → Clusters** — use the same WireGuard IP as always (`https://10.99.0.x:8006`).
Nothing changes on the PCC side. The hub's peer entry in `wg0.conf` stays identical.

#### Testing failover

Stop keepalived on the primary node:
```bash
systemctl stop keepalived   # on the primary
```

Within 3 seconds, the backup node should take over. Check on the backup:
```bash
wg show   # should now show the WireGuard interface
```

PCC should continue working without any manual intervention.

> **Note:** `nopreempt` prevents the original master from taking back control when it recovers.
> This avoids unnecessary tunnel flaps. Remove it if you prefer the highest-priority node to
> always be master.

---

## Step 10 — Add team members

Go to **Admin → PCC Admin → Users → + Add User**:

| Field | Note |
|---|---|
| Username | e.g. `alice` |
| Password | Min 8 characters — user should change on first login |
| Role | `admin` = full access · `user` = view + operate, no cluster/user management |

Each team member logs into `https://pcc.yourdomain.com` with their own credentials.
All shared settings (host profiles, affinity rules, saved views, scheduled jobs) sync across the team automatically.

---

## Ongoing operations (standalone)

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

**The easy way — `pcc-update` command**

If set up correctly (installed by `setup.sh` automatically, or see below), just run:

```bash
pcc-update
```

That's it. It pulls the latest from GitHub, copies all files, runs `npm install`, and restarts the service.

**First time on an existing install** — install the command once:

```bash
wget -qO /usr/local/bin/pcc-update https://raw.githubusercontent.com/bclaremont/proxmox-dashboard/master/server/update.sh
chmod +x /usr/local/bin/pcc-update
```

---

**Manual update (if you prefer):**

*Quick — UI changes only, no restart needed:*
```bash
git clone https://github.com/bclaremont/proxmox-dashboard.git /tmp/pcc-update
cp /tmp/pcc-update/proxmox-dashboard.html /opt/pcc/public/index.html
cp /tmp/pcc-update/console.html           /opt/pcc/public/console.html
cp -r /tmp/pcc-update/vendor              /opt/pcc/public/vendor
rm -rf /tmp/pcc-update
```

*Full — backend changes, restart required:*
```bash
git clone https://github.com/bclaremont/proxmox-dashboard.git /tmp/pcc-update
cp /tmp/pcc-update/server/server.js       /opt/pcc/server.js
cp /tmp/pcc-update/server/package.json    /opt/pcc/package.json
cp /tmp/pcc-update/proxmox-dashboard.html /opt/pcc/public/index.html
cp /tmp/pcc-update/console.html           /opt/pcc/public/console.html
cp -r /tmp/pcc-update/vendor              /opt/pcc/public/vendor
cd /opt/pcc && npm install --omit=dev
systemctl restart pcc
rm -rf /tmp/pcc-update
```

### TLS certificate renewal

**This is fully automatic** — you don't need to do anything. `setup.sh` configured certbot's
systemd timer which checks twice daily and renews any cert within 30 days of expiry. nginx
reloads automatically after each renewal via the post-renewal hook.

To verify auto-renewal is working:
```bash
systemctl status certbot.timer
```

If you ever need to force a manual renewal (e.g. after changing DNS):
```bash
certbot renew --force-renewal && systemctl reload nginx
```

### Backup the database
The SQLite database holds all your cluster configs, users, schedules, shared settings:
```bash
cp /opt/pcc/data/pcc.db /opt/pcc/data/pcc.db.bak-$(date +%Y%m%d)
```
For offsite backup, copy `pcc.db` anywhere — it's a single self-contained file.

---

## Security reference

PCC includes several layers of protection out of the box. This section summarises what is built in so you know what is and isn't covered.

### Authentication

| Feature | Detail |
|---|---|
| **Password hashing** | bcrypt (cost factor 10) — passwords are never stored in plaintext |
| **Session tokens** | JWT, 4-hour expiry, unique JTI per token |
| **Token revocation** | Logout invalidates the token server-side immediately |
| **Auto-refresh** | Tokens are automatically refreshed 10 minutes before expiry — no mid-session logouts |
| **Login rate limiting** | 10 attempts per IP per 15-minute window → 429 Too Many Requests |
| **Account lockout** | 10 consecutive failures locks the account for 30 minutes, regardless of source IP |
| **Audit log** | Every login attempt (success, failure, rate-limit, lockout) is logged with source IP |

### Data protection

| Feature | Detail |
|---|---|
| **Proxmox API tokens** | Encrypted at rest using AES-256-GCM with a key derived from `JWT_SECRET` |
| **No CDN requests** | All JS libraries (Chart.js, Leaflet, noVNC, qrcodejs) are self-hosted — no external requests on page load |
| **Map tiles** | EU-hosted (FOSSGIS e.V., Germany) with a consent gate — tiles only load after explicit user action |
| **`X-Powered-By`** | Removed — Express does not advertise itself in response headers |

### Network / server

| Feature | Detail |
|---|---|
| **HTTPS** | Standalone mode: Let's Encrypt with automatic renewal. Direct mode: HTTP only (see note below) |
| **Security headers** | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `X-XSS-Protection`, `Permissions-Policy` on all responses |
| **HSTS** | Enabled in standalone mode (HTTPS). Not applicable in direct mode (HTTP) |
| **Firewall** | UFW configured in Step 2 — only ports 22/80/443/51820 open |
| **fail2ban** | SSH brute-force protection configured in Step 2 |
| **AppArmor** | Enabled in Step 2 — nginx profile enforced |
| **System user** | PCC backend runs as `pcc` system user (no shell, no login) |

### What is NOT covered (and why)

- **Content Security Policy** — PCC uses inline `<script>` blocks throughout the single-file HTML. A meaningful CSP would require a large refactor and is not yet implemented.
- **JWT revocation across restarts** — the revocation blacklist is in-memory. A server restart clears it. Acceptable because tokens expire in 4h anyway.
- **Direct mode HTTPS** — adding TLS to the direct mode nginx requires a certificate. Add one (self-signed or Let's Encrypt) if you need HTTPS on port 8080.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| PCC won't start | `journalctl -u pcc -n 50` — usually a missing .env or bad JWT_SECRET |
| `502 Bad Gateway` | `systemctl status pcc` — the Node.js process may have crashed |
| Let's Encrypt failed | Verify port 80 is reachable: `curl http://pcc.yourdomain.com` from outside |
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

### Locked out — 2FA broken or authenticator lost

If a PCC account has 2FA enabled (Admin → My Account → Two-Factor Authentication) and the
authenticator device is lost, broken, or the code is rejected, an **admin** can normally
disable it for you from Admin → Users → "Disable 2FA". But if the locked-out account is the
*only* admin, there's no other account to do that from — SSH into the PCC server instead and
run the break-glass script that ships with PCC:

```bash
cd /opt/pcc
node reset-2fa.js --list          # see every user and their 2FA status
node reset-2fa.js <username>      # disable 2FA for that user
```

This writes directly to `pcc.db` — no restart needed, the user can sign in with just their
password on the next attempt. Have them re-enable 2FA once they have a working authenticator.

There's no equivalent one-liner for a fully forgotten *password* yet — for now that requires
generating a bcrypt hash and updating `users.password_hash` in `pcc.db` by hand.

---

---

## Part B — Direct Mode (Proxmox host, no separate VM)

Direct mode runs PCC directly on a Proxmox host, served by nginx on port 8080.
nginx acts as a reverse proxy to the Proxmox API on port 8006.

> **Note:** Proxmox does **not** include nginx — it uses its own `pveproxy` on port 8006.
> You need to install and configure nginx from scratch. The `setup.sh` script from Part A
> is **not used here** — direct mode is fully manual.

### Direct mode setup (fresh Proxmox host)

Run these commands **on the Proxmox host** as root:

```bash
# 1. Install nginx
apt install -y nginx

# 2. Clone the repo (or copy files from another host)
apt install -y git
git clone https://github.com/bclaremont/proxmox-dashboard.git /tmp/pcc-src

# 3. Copy the HTML files to the web root
mkdir -p /var/www/proxmox-dashboard
cp /tmp/pcc-src/proxmox-dashboard.html /var/www/proxmox-dashboard/index.html
cp /tmp/pcc-src/console.html           /var/www/proxmox-dashboard/console.html
cp -r /tmp/pcc-src/vendor              /var/www/proxmox-dashboard/vendor

# 4. Copy the nginx configs
cp /tmp/pcc-src/nginx/proxmox-dashboard.conf /etc/nginx/sites-available/proxmox-dashboard
cp /tmp/pcc-src/nginx/pcc-vnc-map.conf       /etc/nginx/conf.d/pcc-vnc-map.conf

# 5. Enable the site and reload nginx
ln -sf /etc/nginx/sites-available/proxmox-dashboard /etc/nginx/sites-enabled/proxmox-dashboard
rm -f  /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 6. Clean up
rm -rf /tmp/pcc-src
```

PCC is now available at `http://your-pve-ip:8080`.

Open it in your browser and connect with your Proxmox credentials (username e.g. `root@pam`).

### Keeping direct mode up to date

When a new version of PCC is released:

```bash
git clone https://github.com/bclaremont/proxmox-dashboard.git /tmp/pcc-update
cp /tmp/pcc-update/proxmox-dashboard.html /var/www/proxmox-dashboard/index.html
cp /tmp/pcc-update/console.html           /var/www/proxmox-dashboard/console.html
cp -r /tmp/pcc-update/vendor              /var/www/proxmox-dashboard/vendor
rm -rf /tmp/pcc-update
```

No nginx restart needed — the HTML is served as static files.

### Limitations of direct mode vs standalone
- No team login — anyone who can reach port 8080 has access
- Shared settings (profiles, rules, schedules) are browser-local only
- Scheduled operations only run while the browser is open
- No audit log of who did what

---

*PCC is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Proxmox Server Solutions GmbH. Proxmox® and Proxmox VE® are registered trademarks of Proxmox Server Solutions GmbH.*
