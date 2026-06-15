# PCC — Proxmox Command Center

**PCC** is an open-source, browser-based management dashboard for [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment/overview). It provides a single interface across multiple clusters and standalone hosts, with features that go well beyond the standard Proxmox web UI.

> PCC is an independent open-source project and is not affiliated with, endorsed by, or
> sponsored by Proxmox Server Solutions GmbH.
> Proxmox® and Proxmox VE® are registered trademarks of Proxmox Server Solutions GmbH.

---

## Features

### Fleet management
- **Unified view** — all VMs, containers, nodes and storage across every connected cluster in one interface
- **Multi-cluster** — connect any number of Proxmox clusters and standalone hosts; all views scope correctly per cluster
- **World Map** — pin your infrastructure on a world map and visualise it geographically
- **Heatmap** — node resource usage visualised as a colour-coded grid
- **Cluster Graphs** — RRD-based resource graphs across the whole cluster with 5m / 1h / 24h / 1w / 1mo timeframes

### VM & Container management
- **Full VM/CT lifecycle** — create, start, stop, reboot, clone, migrate, snapshot, backup
- **Console** — in-browser noVNC console (no port forwarding needed)
- **IP addresses** — live IP lookup via QEMU guest agent or cloud-init config
- **VM tags** — label VMs by environment, department or policy with colour-coded chips
- **Content Library** — manage templates with metadata, version tags and OS icons
- **Customisation Specs** — cloud-init templates applied automatically on clone deploy
- **Prepare as Template wizard** — guided cleanup, cloud-init drive, and conversion
- **Performance graphs** — per-VM/CT RRD charts (CPU, RAM, network) directly from the VM list

### Automation
- **DRS** — compute and storage dynamic resource scheduling; cluster-scoped, prevents cross-cluster migration suggestions
- **Affinity rules** — force VMs onto the same node (affinity) or different nodes (anti-affinity); cluster-aware VM picker with cross-cluster warning
- **Scheduled operations** — start, stop, backup and snapshot VMs on a schedule (24/7 in standalone mode); snapshot retention auto-deletes oldest
- **Capacity planning** — trend-based forecasting of when CPU, RAM or disk will be exhausted
- **Host Profiles** — capture a reference node's config and detect/fix drift across the fleet
- **Host Config Backup** — nightly snapshot of every node's DNS, timezone, network interfaces and storage config saved to SQLite; disaster-recovery reference if a host is lost and needs rebuilding; compare snapshots to see exactly what changed between runs
- **Maintenance drain** — evacuate all VMs from a node before maintenance with one click
- **Cross-cluster VM copy** — guided 4-step wizard to cold-copy a VM between clusters (vzdump → scp → vzrestore); useful for DR and cluster migrations
- **Config export/import** — backup and restore all PCC settings (rules, schedules, webhooks, specs) as a JSON file; supports merge or full-replace import

### Monitoring & alerting
- **SMART + ZFS health** — per-node physical disk health (SMART status, temperature, wearout) and ZFS pool status (health, usage, fragmentation)
- **Uptime Report** — all running VMs/CTs sorted by uptime with colour coding (green <7d → red >90d "patch?")
- **Per-VM performance alerts** — notify when a specific VM's CPU or RAM exceeds a threshold for a sustained period
- **Email / webhook digest** — daily or weekly summary email (SMTP) or JSON webhook: cluster health, stopped VMs, storage warnings, long-running VMs
- **Webhooks** — push alerts to Slack, Teams, Discord or any HTTP endpoint
- **Notifications panel** — in-app alert feed with severity colour coding

### Reporting
- **Reports** — cluster utilisation summaries, VM inventory, node and storage tables
- **CSV export** — download any report as a dated CSV file
- **Markdown copy** — copy a formatted report to paste into Notion, email or a ticket

### Infrastructure management
- **Storage** — add, edit, enable/disable storage pools
- **Network** — manage bridges, bonds, VLANs; apply pending changes
- **SDN** — full software-defined networking (zones, VNets, subnets, controllers)
- **High Availability** — manage HA groups and resources
- **Firewall** — cluster and VM/CT firewall rules
- **Datacenter** — cluster options, migration network config, replication jobs
- **Backups** — vzdump backup jobs and PBS integration
- **Disk Health** — SMART status and ZFS pool health per node across all clusters

### Administration
- **Users & Permissions** — manage Proxmox users, groups, API tokens and roles
- **2FA** — manage TOTP and WebAuthn authentication
- **SSO & Auth Realms** — LDAP, Active Directory and OpenID Connect
- **Certificates** — ACME/Let's Encrypt and custom certificate management
- **Updates** — package update management across nodes
- **Tags** — manage allowed VM/CT tags cluster-wide

### Standalone server mode
When deployed on its own Debian VM, PCC adds team and security features:
- **Per-user logins** with roles (admin / user)
- **IP allowlist** — restrict PCC access to defined CIDR ranges; 127.0.0.1 always permitted
- **Login activity log** — every login attempt recorded with IP, timestamp, success/failure and browser
- **Idle session timeout** — configurable auto-logout (15 min – 8 hours) with 60-second warning banner
- **Shared settings** — profiles, affinity rules, saved views and schedules synced across the team
- **Audit log** — every write operation recorded with source IP
- **Cluster registry** — Proxmox API tokens stored AES-256-GCM encrypted at rest
- **WireGuard** — secure connectivity to remote Proxmox clusters without exposing APIs to the internet
- **Email/webhook digest** — scheduled summary reports sent server-side 24/7

### UI
- **Command palette** — `Cmd+K` / `Ctrl+K` opens a fuzzy-search overlay across all VMs, containers, nodes and views
- **Keyboard shortcuts** — `?` for help, `g v` for VMs, `g n` for nodes, and more
- **Dark theme** — full dark UI with CSS variable system

---

## Architecture

PCC is a **single HTML file** at its core — no build step, no framework.

```
proxmox-dashboard.html   — the entire dashboard UI and client-side logic
console.html             — in-browser noVNC console popup
vendor/                  — self-hosted JS/CSS libraries (no CDN calls)
server/                  — Node.js + SQLite backend (standalone mode only)
  server.js              — Express API, JWT auth, Proxmox proxy, scheduler
  setup.sh               — one-command Debian install with Let's Encrypt
  add-site.sh            — WireGuard hub-and-spoke site addition
  update.sh              — pull latest and restart (installed as pcc-update)
nginx/                   — nginx config files for both deployment modes
```

### Deployment modes

| | Standalone VM | Direct (Proxmox host) |
|---|---|---|
| **Setup** | `bash setup.sh --domain … --email …` | ~6 manual steps |
| **HTTPS** | ✅ Let's Encrypt automatic | ❌ HTTP only |
| **Team logins** | ✅ | ❌ |
| **Scheduled jobs 24/7** | ✅ | ❌ browser only |
| **Encrypted secrets** | ✅ | ❌ |
| **IP allowlist** | ✅ | ❌ |
| **Email digest** | ✅ | ❌ |

See **[SETUP.md](SETUP.md)** for full installation instructions.

---

## Quick start (direct mode)

The fastest way to try PCC — runs on any Proxmox host in a few minutes:

```bash
# On the Proxmox host
apt install -y nginx git
git clone https://github.com/bclaremont/proxmox-dashboard.git /tmp/pcc-src
mkdir -p /var/www/proxmox-dashboard
cp /tmp/pcc-src/proxmox-dashboard.html /var/www/proxmox-dashboard/index.html
cp /tmp/pcc-src/console.html           /var/www/proxmox-dashboard/console.html
cp -r /tmp/pcc-src/vendor              /var/www/proxmox-dashboard/vendor
cp /tmp/pcc-src/nginx/proxmox-dashboard.conf /etc/nginx/sites-available/proxmox-dashboard
cp /tmp/pcc-src/nginx/pcc-vnc-map.conf       /etc/nginx/conf.d/pcc-vnc-map.conf
ln -sf /etc/nginx/sites-available/proxmox-dashboard /etc/nginx/sites-enabled/proxmox-dashboard
rm -f  /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
rm -rf /tmp/pcc-src
```

Open `http://your-pve-host:8080` and connect with your Proxmox credentials.

For production use with HTTPS, team logins and 24/7 scheduling, see the [standalone setup guide](SETUP.md).

---

## Security

- All JS/CSS libraries self-hosted — **no external CDN requests** on page load
- Map tiles served from **EU infrastructure** (FOSSGIS e.V., Germany) with a consent gate
- Proxmox API tokens **encrypted at rest** (AES-256-GCM)
- Login **rate limiting** (per-IP) + **account lockout** (per-username)
- JWT **revocation on logout**, 4-hour token expiry with auto-refresh
- **IP allowlist** — restrict PCC to named CIDR ranges (standalone mode)
- **Login activity log** — every attempt recorded with IP, UA, success/failure
- **Idle session timeout** — configurable auto-logout with 60-second warning
- Full **audit log** of all write operations including auth events
- See the [Security reference](SETUP.md#security-reference) in SETUP.md for full details

---

## Licence

MIT — see [LICENSE](LICENSE)

Third-party libraries: Chart.js (MIT), Leaflet (BSD-2), noVNC (MPL-2.0), qrcodejs (MIT), nodemailer (MIT)
Map data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL)
