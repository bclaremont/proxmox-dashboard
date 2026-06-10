# Changelog

All notable changes to PCC are documented here.

---

## [Unreleased]

---

## Monitoring features (2026-06)

### Added
- **Disk Health view** — new nav item; shows per-node SMART physical disk table (device, model, type, size, health ✓/✗, temperature, wearout %) and ZFS pool table (name, health colour-coded, size/used gauge, free, fragmentation); node selector + cluster selector
- **Uptime Report view** — new nav item; all running VMs/CTs sorted by uptime; colour coded green (<7d), blue (7–30d), yellow (30–90d), red (>90d) with "⚠ patch?" flag; stats grid counts per tier; multi-cluster aware
- **Email / webhook digest** — daily or weekly summary report sent server-side 24/7; content: online/offline nodes, running/stopped VM counts, storage >80% warnings, long-running VMs; SMTP via nodemailer + JSON webhook; "Send Test Now" button; configured in PCC Admin → Security
- `nodemailer` added to `server/package.json`

---

## Security features (2026-06)

### Added
- **IP allowlist** — middleware in server.js checks every request against stored CIDR list; 127.0.0.1/::1 always permitted; empty list = allow all; managed in PCC Admin → Security
- **Login activity log** — every login attempt (success + failure) recorded in new `login_log` DB table with IP, username, success flag, user-agent; displayed in PCC Admin → Security with success/fail badges
- **Idle session timeout** — configurable (15 min – 8 hours or disabled) via PCC Admin → Security; yellow warning banner appears 60 seconds before expiry with "Stay logged in" button; auto-logout on expiry
- **Security tab** in PCC Admin — combines IP allowlist, idle timeout, email digest config, and login activity log
- New DB tables: `login_log`, `settings` (key-value store for all server-side settings)
- `getSetting()` / `setSetting()` helpers; `_clientIp()`, `_ipInCidr()`, `_ipToInt()` CIDR helpers
- New API routes: `GET/PUT /api/admin/settings`, `GET /api/admin/login-log`, `POST /api/admin/digest/test`

---

## UI improvements (2026-06)

### Added
- **Command palette** — `Cmd+K` / `Ctrl+K` opens fuzzy-search overlay; searches VMs, containers, nodes and all views simultaneously; arrow key navigation, Enter to select, Escape to close; results grouped by category with status dot
- **Performance graphs** — 📊 button on every VM/CT row opens RRD chart modal; 4 charts: CPU %, Memory, Net In, Net Out; timeframe selector 5m / 1h / 24h / 1w / 1mo; SVG line charts with fill, grid lines, avg + peak stats
- **Scheduled snapshot quick-access** — 📸 button on every VM/CT row pre-fills schedule modal with that VM and action=snapshot
- **Snapshot retention** — new "Keep last N" field in snapshot schedule options; server-side `_scheduleExecute` auto-deletes oldest matching snapshots after each run
- **5-minute timeframe** on all RRD graph views — fetches `hour` data and slices last 5 points; added to VM/CT/node detail graphs, Cluster Graphs view, and the new performance modal
- `modal-wide` CSS class for wider modals (perf graphs); cleared on `closeModal()`

---

## Multi-cluster audit fixes (2026-06)

### Fixed
- **Tags view** — `allVMs()/allCTs()` replaced with conn-scoped list; selecting a cluster now correctly shows only that cluster's VMs
- **Network view** — stored data in `PVE.network` (primary only) even when remote cluster selected; replaced with `_netIfaces` module variable scoped per `loadNetwork()` call
- **Datacenter status tab** — used `allVMs().concat(allCTs())`; now resolves via `resolveConn(dcData.connId)` for the selected cluster
- **DRS Compute** — `_drsNodeInfo` VM filter now checks both `node` and `connId` (prevents node-name collisions across clusters); `_findMigrations` guards against cross-cluster migrations (impossible with standard PVE live-migrate); `runDRSAnalysis` uses `drs-conn` selector; default shows all clusters with cluster name in balance score header
- **Storage DRS** — `runStorageDRSAnalysis` uses `drs-conn` selector; fetches storage fresh on demand if cache empty (no longer requires opening Storage view first)
- **Affinity rules** — filter by `rule.connId` stored on the rule (not VMID lookup which collides when clusters share VMIDs); VM picker uses `<optgroup>` per cluster; `vmid|connId` encoded in option values; cross-cluster selection blocked on save; `_populateAffinityConnSel` with "All Clusters / Primary / per-cluster" options
- **Affinity enforcement** — anti-affinity fix candidates scoped to same cluster as VM (was using `allNodes()` which could suggest cross-cluster targets)
- Reports view was already correct; confirmed not broken

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
