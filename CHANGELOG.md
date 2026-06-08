# Changelog

All notable changes to PCC are documented here.

---

## [Unreleased]

---

## Security hardening (2026-06)

### Added
- JWT token revocation on logout — tokens invalidated server-side immediately
- `POST /api/auth/refresh` endpoint — silent token renewal 10 min before 4h expiry
- Account lockout — 10 consecutive failures locks account for 30 minutes
- Login rate limiting — 10 attempts per IP per 15-minute window (429 response)
- Failed login audit logging — every attempt recorded with source IP and reason
- AES-256-GCM encryption of Proxmox API tokens at rest in SQLite
- Startup migration — existing plaintext tokens encrypted automatically
- World Map consent gate — tiles only load after explicit user click
- World Map EU tile server — switched to FOSSGIS e.V. (Germany) mirror
- Self-hosted vendor libraries — Chart.js, Leaflet, noVNC, qrcodejs (no CDN calls)
- MIT licence (`LICENSE`)
- nginx security headers for direct mode (X-Frame-Options, nosniff, Referrer-Policy, etc.)
- `X-Powered-By` header removed from standalone backend
- Security reference section in SETUP.md

### Changed
- JWT expiry reduced from 12h to 4h
- Product name: "Proxmox Command Center" → **PCC** (removes trademark from product name)
- Removed all vCenter/VMware references from user-facing text and code comments

---

## SETUP.md — Standalone deployment guide (2026-06)

### Added
- Comprehensive standalone setup guide covering all 10 steps
- Comparison table: Standalone VM vs Direct mode
- Server hardening step: UFW, fail2ban, unattended-upgrades, SSH keys, AppArmor
- WireGuard hub-and-spoke setup for remote Proxmox sites (`add-site.sh`)
- Direct mode setup instructions (nginx not pre-installed on Proxmox)
- Update, backup, and troubleshooting sections

---

## UI polish — multiple rounds (2026-06)

### Added
- View fade-in transitions (150ms ease, replays on every navigation)
- Running badge dot pulse animation
- Modal header colour strips (orange=create, red=delete, green=success, blue=info)
- VM/CT quick filter pills with live counts (All / Running / Stopped)
- Click-to-copy on IP addresses and VMIDs
- Sidebar collapsed tooltips (hover icon → view name popover)
- Task log colour coding (red bar for errors, yellow for running)
- Empty states with icons, descriptions and CTA buttons
- Overview Top VMs — visual bar chart replacing plain table
- Notification panel severity strips (coloured left bars)
- Browser tab title updates to show connected node names
- Toast icons with coloured circles per severity (✓ ✕ ⚠ ℹ)
- Warning toast type (was missing)
- Toast fade-out animation before removal

### Changed
- Stat cards: 3px coloured left border per accent type
- Gauge bars: 5px → 7px, rounder end caps
- Table row padding: 10px → 11px vertical
- VM/CT type chips: brighter colours, filled background, bolder text
- Clickable table row hover: stronger tint + orange left accent bar
- Section titles: `--muted` → `--text` colour
- Buttons: tighter sizing (13px, 7px padding)
- Input focus: orange glow `box-shadow` added
- VM card hover: stronger border + glow ring
- VM detail panel: 700px fixed → `clamp(740px, 48vw, 1100px)` responsive
- ⤢ expand button added to detail panel header
- Topbar: Refresh label removed (icon-only), last-refresh time moved to tooltip, uptime moved to conn-status pill tooltip

---

## VM IP addresses + enhanced detail panel (2026-06)

### Added
- IP address shown as monospace sub-line under VM/CT name in all tables
- Lazy background fetch: QEMU guest agent → cloud-init ipconfig0 → LXC net0 config
- Per-session cache, batched 6 at a time
- Detail panel Overview tab: IP address info box, OS type, CPU cores×sockets, BIOS, machine type, RAM allocated, tags, description

---

## Content Library + Template workflow (2026-06)

### Added
- Content Library view (Actions section) — unified catalogue of VM templates, CT templates and ISOs
- Library metadata per item: description, version tag, OS type, recommended Customisation Spec
- ▶ Deploy — clone modal pre-loaded with default spec
- 🌐 Publish — step-by-step cross-cluster publish guide
- VM Templates guide — inline 6-step guide with dismiss/restore
- **Prepare as Template wizard** — guided 4-step process: shutdown, cleanup via guest agent, cloud-init drive, convert

---

## Scheduled operations (2026-06)

### Added
- Scheduled Operations view (Automation section)
- Actions: start, graceful shutdown, force stop, reboot, backup (vzdump), snapshot
- Schedule types: daily, weekly (day picker), hourly
- Browser-based tick (60s) while tab is open
- Backend server-side tick (60s) in standalone mode — runs 24/7
- Enable/disable toggle, Run Now button, countdown to next run

---

## Reports & Export (2026-06)

### Added
- Reports & Export view (Admin section)
- Tabs: Summary, VM Inventory, Node Utilisation, Storage
- Per-cluster filter
- CSV export for all tabs (dated filenames)
- Markdown copy for summary + VM inventory

---

## Webhooks & External Notifications (2026-06)

### Added
- Webhooks view (Admin section)
- Targets: Slack, Microsoft Teams, Discord, Generic JSON POST
- Per-webhook: severity filter, type filter, Bearer token auth
- Test button, enable/disable toggle
- Fires from all notification types (CPU, RAM, VM down, per-VM alerts, etc.)
- Quick-start guide for each provider

---

## Per-VM performance alerts (2026-06)

### Added
- Per-VM alert rules — CPU, RAM or disk threshold for a sustained duration
- ⚡ VM Rules button in notification panel
- 🔔 Alert shortcut on VM cards and detail panel
- Live breach counter shown in rules list
- 15-minute cooldown between repeat notifications

---

## Storage DRS (2026-06)

### Added
- Storage DRS tab on DRS view (alongside Compute DRS)
- Datastore utilisation table with gauge bars
- Disk move recommendations: largest disks from overfull → underfull storage
- Execute via `move_disk` (QEMU) or `move_volume` (LXC) with `delete=1`
- Configurable overfull/underfull thresholds in DRS Settings

---

## VM Customisation Specs (2026-06)

### Added
- Customisation Specs view (Automation section)
- Spec fields: hostname template, domain, network (DHCP/static), DNS, user, SSH key
- `{name}` and `{vmid}` placeholders in hostname
- Enhanced Clone modal with spec picker and inline preview
- Post-clone cloud-init config applied 3s after clone starts

---

## Migration Network (2026-06)

### Added
- Migration Network tab in Datacenter view
- Per-node interface topology with CIDR matching highlights
- Live preview of which NIC each node would use as CIDR is typed
- Quick-configure form: type, CIDR, bandwidth limit

---

## Host Profiles (2026-06)

### Added
- Host Profiles view (Automation section)
- Capture node config: DNS, timezone, custom /etc/hosts entries
- Compliance dashboard — detect drift across all nodes
- Apply profile to multiple nodes simultaneously
- Cluster Join Wizard — guided process for adding a new node
- Answer File Generator — Proxmox unattended install TOML

---

## Standalone server (PCC backend) (2026-06)

### Added
- Node.js + Express + SQLite backend (`server/server.js`)
- Per-user JWT authentication with roles (admin / user)
- Cluster registry with encrypted API token storage
- Streaming proxy to Proxmox APIs (handles ISO uploads)
- Shared state sync — all settings synced across team
- WebSocket VNC proxy for console in standalone mode
- `server/setup.sh` — one-command Debian install with Let's Encrypt
- `server/add-site.sh` — WireGuard hub-and-spoke site addition
- PCC Admin view — clusters, users, audit log, account management
- PCC login overlay (shown when backend detected, hidden in direct mode)

---

## VM Console (noVNC) (2026-05)

### Added / Fixed
- `console.html` — self-contained noVNC popup (no Proxmox UI dependency)
- VNC ticket fetched via `vncproxy` before opening console
- PVE auth injected by nginx for WebSocket (browsers cannot set custom WS headers)
- `pcc-vnc-map.conf` — nginx map to strip `pveauth` param before forwarding to Proxmox
- Node shell via `termproxy`
- Session expiry banner when API returns 401

---

## Earlier features (2026-05)

### Added
- Affinity / anti-affinity rules
- Maintenance Mode drain
- Capacity Planning & Forecasting
- VM Tags & Categories with colour chips and tag-based saved views
- World Map (Leaflet, cluster location pins)
- Bulk VM/CT operations
- SDN management (zones, VNets, subnets, controllers)
- High Availability management
- Firewall management
- Backup management + PBS integration
- Network interface management
- Storage management
- Ceph management
- Resource Pools
- Users & Permissions
- 2FA management
- SSO & Auth Realms
- Certificate management (ACME / Let's Encrypt)
- Update management
- Multi-cluster support with per-cluster connection selectors
- Custom Saved Views
- Subscription management
- Heatmap view
- Cluster Graphs (RRD)
- ISO & Template Library with upload
- Create VM wizard (multi-step)
- Create CT wizard
- DRS (Compute Dynamic Resource Scheduling)

---

## Initial release (2026-05)

### Added
- Single-file Proxmox VE dashboard
- VM and container list with live resource gauges
- Node overview with CPU/RAM/disk metrics
- Task log and system log viewer
- Dark/light theme toggle
- Global search (Ctrl+K)
- Keyboard shortcuts
