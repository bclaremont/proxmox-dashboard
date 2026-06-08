# PCC — Proxmox Management Dashboard

**PCC** is an open-source, browser-based management dashboard for [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment/overview). It provides a single interface across multiple clusters and standalone hosts, with features that go well beyond the standard Proxmox web UI.

> PCC is an independent open-source project and is not affiliated with, endorsed by, or
> sponsored by Proxmox Server Solutions GmbH.
> Proxmox® and Proxmox VE® are registered trademarks of Proxmox Server Solutions GmbH.

---

## Features

### Fleet management
- **Unified view** — all VMs, containers, nodes and storage across every connected cluster in one interface
- **Multi-cluster** — connect any number of Proxmox clusters and standalone hosts simultaneously
- **World Map** — pin your infrastructure on a world map and visualise it geographically
- **Heatmap** — node resource usage visualised as a colour-coded grid

### VM & Container management
- **Full VM/CT lifecycle** — create, start, stop, reboot, clone, migrate, snapshot, backup
- **Console** — in-browser noVNC console (no port forwarding needed)
- **IP addresses** — live IP lookup via QEMU guest agent or cloud-init config
- **VM tags** — label VMs by environment, department or policy with colour-coded chips
- **Content Library** — manage templates with metadata, version tags and OS icons
- **Customisation Specs** — cloud-init templates applied automatically on clone deploy
- **Prepare as Template wizard** — guided cleanup, cloud-init drive, and conversion

### Automation
- **DRS** — compute and storage dynamic resource scheduling across nodes and datastores
- **Affinity rules** — force VMs onto the same node (affinity) or different nodes (anti-affinity)
- **Scheduled operations** — start, stop, backup and snapshot VMs on a schedule (24/7 in standalone mode)
- **Capacity planning** — trend-based forecasting of when CPU, RAM or disk will be exhausted
- **Host Profiles** — capture a reference node's config and detect/fix drift across the fleet
- **Maintenance drain** — evacuate all VMs from a node before maintenance with one click

### Monitoring & alerting
- **Per-VM performance alerts** — notify when a specific VM's CPU or RAM exceeds a threshold for a sustained period
- **Webhooks** — push alerts to Slack, Teams, Discord or any HTTP endpoint
- **Notifications panel** — in-app alert feed with severity colour coding
- **Task log colour coding** — error and running tasks highlighted for instant scanning
- **Cluster Graphs** — RRD-based resource graphs across the whole cluster

### Reporting
- **Reports & Export** — cluster utilisation summaries, VM inventory, node and storage tables
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

### Administration
- **Users & Permissions** — manage Proxmox users, groups, API tokens and roles
- **2FA** — manage TOTP and WebAuthn authentication
- **SSO & Auth Realms** — LDAP, Active Directory and OpenID Connect
- **Certificates** — ACME/Let's Encrypt and custom certificate management
- **Updates** — package update management across nodes
- **Tags** — manage allowed VM/CT tags cluster-wide

### Standalone server mode
When deployed on its own Debian VM, PCC adds team features:
- **Per-user logins** with roles (admin / user)
- **Shared settings** — profiles, affinity rules, saved views and schedules synced across the team
- **Audit log** — every login attempt and write operation recorded with source IP
- **Cluster registry** — Proxmox API tokens stored AES-256-GCM encrypted at rest
- **WireGuard** — secure connectivity to remote Proxmox clusters without exposing APIs to the internet

---

## Architecture

PCC is a **single HTML file** at its core — no build step, no framework.

```
proxmox-dashboard.html   — the entire dashboard UI and client-side logic
console.html             — in-browser noVNC console popup
vendor/                  — self-hosted JS/CSS libraries (no CDN calls)
server/                  — Node.js + SQLite backend (standalone mode only)
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
- Full **audit log** of all auth events including failures and rate-limit blocks
- See the [Security reference](SETUP.md#security-reference) in SETUP.md for full details

---

## Licence

MIT — see [LICENSE](LICENSE)

Third-party libraries: Chart.js (MIT), Leaflet (BSD-2), noVNC (MPL-2.0), qrcodejs (MIT)
Map data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL)
