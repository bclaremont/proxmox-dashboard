# Changelog

All notable changes to PCC are documented here.

---

## [Unreleased]

---

## Security follow-up — XSS and shared-state privilege escalation in newer features (2026-07)

### Fixed
- **Privilege escalation — shared-state admin gating not extended to newer features** — `SHARED_ADMIN_KEYS` in `server.js` still only covered `pve-schedules`/`pve-webhooks`/`pve-alert-thresholds` from the original hardening pass. Four keys added since then (`pve-affinity-rules`, `pve-drs-settings`, `pve-host-profiles`, `pve-custom-specs`) were writable by any authenticated user despite driving privileged actions once an admin enforces/applies/deploys them (live migration, node config changes, cloud-init VM deploys) — now admin-gated the same way
- **Stored XSS — Customisation Specs list** — the static IP/gateway fields were escaped in the create/edit form but not in the spec list view; now consistently escaped
- **Stored XSS — Host Profiles list** — DNS/timezone/NTP fields were escaped in the Apply Profile modal but not in the profile list view; now consistently escaped
- **Minor escaping gaps** — node names/storage names in Cluster Graphs tab buttons, the Maintenance Drain local-storage warning, and the Apply Profile node picker are now escaped for consistency (low exploitability — values are PVE-controlled, not free user text)

---

## Log Viewer, Datastore browser, Snapshot manager, Heatmap, VM notes (2026-06/07)

### Added
- **Log Viewer improvements** — task duration calculated from UPID hex timestamps in Cluster Events; "recent ops" default (last 50 tasks across all nodes) instead of blank-until-search; task output drill-down (`GET /nodes/{node}/tasks/{upid}/log`); error/warn summary banner across loaded syslog and cluster event data
- **Anomaly badges on VM rows** — small ↑ badge on the VM name when current CPU/RAM is significantly above that VM's own rolling average from sparkline history; tooltip shows spike detail
- **Datastore browser** — 📂 Browse button on each storage row opens a modal to browse, download, and delete files on a storage pool via `/nodes/{node}/storage/{storage}/content`; type filter chips, size totals, orphaned disk image detection
- **Snapshot manager view** — dedicated Snapshots view fetching all snapshots across every VM/CT in parallel; sortable by age/name; summary cards; per-row Rollback and Delete; old snapshots highlighted amber
- **Quick filter chips** — one-click pills (Running / Stopped / High CPU / Anomaly) above the VM/CT table with live counts, zero extra API calls
- **Right-click context menu on VM rows** — fast context menu (power, console, open detail, migrate, move disk, clone, performance, snapshot, pin) on main table and Overview table; dismisses on click-outside / Escape / scroll
- **Node update tracker** — pending package count badge per node (amber/red for security); version drift detection highlights minority PVE versions in amber; cached 5 min, works across multi-cluster
- **VM/CT inline notes editor** — read and write the PVE description field directly from the detail panel Overview tab
- **Heatmap view** — colour-coded tile grid of all VMs by chosen metric (CPU, RAM, disk); metric selector + stopped toggle; node resource cards above the tile grid
- **Overview stat card trend badges** — up/down arrows on Overview stat cards and gauge tiles showing change since last refresh
- **Capacity runway** — "Node X: ~14 days until RAM full at current growth rate"; per-node and per-storage projected days-to-full from RRD linear regression; surfaced on Overview
- **Per-VM alert breach badges** — ⚠ badge on the VM row while a per-VM alert rule (⚡ VM Rules) is actively breached
- **Snapshot Timeline tab** — per-VM horizontal row of dots positioned by real snapshot date on a shared, date-scaled time axis; amber for >30 days old, larger dot for RAM-state snapshots

### Fixed
- **Blank screen after login** — dashboard no longer shows a blank screen in the gap before the Overview finishes its first load

---

## Security hardening — XSS, privilege escalation, SSRF, CRLF (2026-06)

### Fixed
- **Privilege escalation via shared state** — `PUT /api/shared/:key` now blocks `user`-role accounts from writing `pve-schedules`, `pve-webhooks`, and `pve-alert-thresholds`; previously any authenticated user could inject VM operations into the backend scheduler
- **Stored XSS — snapshot onclick handlers** — snapshot Rollback/Delete buttons now use `data-*` attributes instead of interpolating snapshot names into `onclick=""` strings; a crafted snapshot name could deliver JS to any admin opening that VM's detail panel
- **Stored XSS — task log** — `taskRow()` and the backup task inline row now escape `node`, `user`, `type`, `id/vmid` via `escHtml()` before innerHTML rendering
- **Stored XSS — schedule view** — `loadSchedules()` escapes `vmid`, `node`, `action` and uses `data-id` on all action buttons; combined with the shared-state fix above this closed a complete stored XSS chain
- **XSS — node cards view** — `n.node` and `d.pveversion` in `_renderNodeCardsView()` now wrapped in `escHtml()`
- **CRLF injection — VNC WebSocket** — upgrade handler now validates `port` (integer 1–65535), `node/ep/vmid` (alphanumeric), and `vncticket` (no CR/LF) before embedding in raw TCP headers
- **`e.message` in innerHTML** — 47 error handler locations that inserted raw `${e.message}` into `innerHTML` or `toast()` now use `${escHtml(e.message)}`; prevents XSS if a proxied cluster returns HTML in its HTTP error body
- **Node names unescaped in DOM** — 59 occurrences of `${n.node}` / `${v.node}` / `${s.node}` in `<option>` text/value, table cells, and headings now wrapped in `escHtml()`
- **Undefined variable in audit log** — proxy route was logging `targetPath` (undefined) instead of `pveRelPath`; write operations now correctly recorded in the audit log
- **Proxy error message** — raw `err.message` (could contain internal hostnames) no longer returned to the client; logged server-side only
- **Node config snapshots** — `GET /api/node-snapshots` now requires admin role; full node network/storage topology should not be readable by user-role accounts

### Added
- **SSRF protection** — `validateClusterHost()` rejects cluster hosts pointing at localhost, 127.x, ::1, 0.0.0.0 or link-local addresses (169.254.x) at cluster create/update time
- **Security response headers** — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` added globally on all API responses
- **JWT_SECRET minimum length** — server refuses to start if `JWT_SECRET` is shorter than 32 characters

---

## UX improvements — pins, search, sparklines, inline expand, snap badges (2026-06)

### Added
- **Pin favourites** — `★` button on every VM/CT row pins it to the top of the table with a visual separator; pin state persisted in localStorage; `☆` to unpin; pins survive view switches and refreshes
- **Persistent sort/search state** — active sort column, sort direction, and search query for VM, CT, and Node tables all saved to localStorage and restored on next visit
- **Snapshot age badges** — each VM/CT row shows a coloured badge when it has snapshots: yellow if the oldest is >7 days, red if >30 days; fetched in background batches of 5 with a 5-minute TTL
- **Inline row expand** — `›` button on each VM/CT row inserts an expand panel below showing Disks, Network interfaces, Snapshots (latest 5 with age colour) and Notes without opening the full detail panel
- **Search with highlight** — VM and CT search boxes highlight matched text in orange; search query persisted across refreshes; search bar expands on focus
- **Node sparklines** — CPU and RAM history sparklines (last 20 data points) shown on sidebar node entries; CPU in accent orange, RAM in blue; ring buffer updated each refresh
- **Node hot badge** — amber dot appears on the sidebar Nodes navigation item when any node exceeds 85% CPU or RAM
- **Clickable overview stat cards** — "Running VMs & CTs", "Stopped VMs & CTs", "Offline Nodes" and "Storage Warnings" cards on the Overview are now clickable and navigate directly to the relevant filtered view
- **Syslog export** — Export button downloads the current (filtered) syslog as a dated `.log` file (`syslog-{node}-{datetime}.log`)
- **Syslog status counter** — shows `{node}: last N of M entries` so you know how much of the log is loaded; updates when node or line count changes
- **Overview health warning dismiss** — Acknowledge and Dismiss buttons on Overview health warning rows
- **Syslog default** — changed from 15 visible lines (CSS clipping) to 100 lines fetched by default; line count selector available (100 / 500 / 1000 / All)

---

## Command palette, nodes table view, refresh indicator (2026-06)

### Added
- **Command palette** (`Ctrl+K` / `Cmd+K`) — full-screen spotlight-style overlay replacing the old inline search bar; fuzzy-searches VMs, containers, nodes, and storage across all connected clusters; opens with quick-navigation shortcuts for every view; keyboard navigation with `↑↓` arrow keys and `Enter` to select; `Esc` to close
- **Nodes table view** — nodes view now has a card/table toggle (matching VMs/CTs); table columns: Node, Cluster (multi-cluster only), Status, CPU %, RAM %, Uptime, VMs/CTs count, PVE version; columns sortable by clicking headers; view preference persisted in localStorage
- **Last-refreshed indicator** — topbar shows "just now" / "42s ago" / "3m ago" next to the refresh button; updates every 10 seconds; turns amber after 2 minutes without a refresh, red after 5 minutes

---

## UI polish, host config backup, reports enhancements (2026-06)

### Added
- **Host Config Backup** (Host Profiles → Host Config Backup tab, standalone mode only) — nightly disaster-recovery capture of every node's DNS, timezone, `/etc/hosts`, network interfaces, node status (hostname, PVE version, kernel, CPU), and storage configuration; stored in SQLite `node_config_snapshots` table; per-node summary cards with full interface/storage detail; backup history with per-field change-diff highlighting (e.g. `dns`, `network` badges when something changed vs previous); JSON export per node; **Backup Now** button for immediate capture; configurable schedule time via `node_snapshot_enabled` / `node_snapshot_time` settings
- **Cluster filter dropdowns** on VMs, Containers, Nodes, and Heatmap views — "All Clusters / Primary / per-cluster" selector; hidden when only one cluster is connected; highlights orange when a filter is active
- **Task polling** — `vmAction` now registers power operations with the task monitor (`tmRegister`); `tmPoll` polls task completion on both primary and extra clusters; fires ✓ success or ✗ error toast when the task finishes instead of an immediate "sent" toast
- **Reports: kernel and PVE version mismatch** — Node Utilisation tab highlights rows where kernel or PVE version differs from the cluster majority; `≠` badge in the affected cell; summary tab warning
- **Reports: OS version column** — VM Inventory shows guest OS via QEMU guest agent `osinfo` (running VMs) or config `ostype` fallback; fetched async and patched in-place
- **Reports: no guest agent detection** — running QEMU VMs where the guest agent didn't respond get a `no agent` badge in the OS column; summary warning counts them
- **Reports: Thin Provisioning tab** — shows physical storage per thin-capable pool (ZFS, LVM-thin, RBD, CephFS, GlusterFS), total VM disk allocation, and overcommit ratio; shared pools de-duplicated to avoid double-counting
- **Overview health banner** — top of the Overview page shows a green "All systems healthy" banner when everything is fine, or clickable warning rows for offline nodes, storage pools >85% full, nodes with CPU/RAM >90%, and recent task errors; each row navigates directly to the relevant view
- **`⚙ Filters` popover** on VM and CT toolbars — group-by-node toggle and tag filter consolidated into a compact dropdown behind a single button; button highlights orange when any filter is active

### Changed
- **Section titles cleaned up** — "Virtual Machines (QEMU/KVM)" → "Virtual Machines"; "LXC Containers" → "Containers"; "Resource Heatmap — Cluster Capacity at a Glance" → "Heatmap"; "Reports & Export" → "Reports"
- **Overview resources header** now shows the actual cluster name instead of the generic "(Primary)"
- **`tmRegister` signature** extended with optional `user` parameter; stores `connId` to enable correct polling for extra-cluster tasks

### Fixed
- **Extra-cluster task polling** — `tmPoll` was only polling primary-cluster nodes; tasks on extra clusters would fall through and be silently marked complete; now uses `connGet(conn, path)` for extra-cluster tasks keyed by `connId`
- **Node Profiles section header duplication** — `renderNodes()` was generating a `<div class="section-header">` inside `#node-cards` after a static one was added to the HTML; removed the dynamic one from the single-cluster code path

---

## Operations, UI polish, and bug fixes (2026-06)

### Added
- **Cross-cluster VM copy wizard** (`⎘→` button on VM rows, shown only when extra clusters are connected) — 4-step guided process: configure destination cluster/node/storage → vzdump backup on source (polled to completion) → scp transfer command with clipboard copy → vzrestore on destination; works for both QEMU VMs and LXC containers
- **Config export/import** (PCC Admin → My Account) — exports all PCC settings (affinity rules, DRS config, webhooks, custom specs, schedules, saved views, host profiles, VM alert rules, locations, content library metadata) as a dated JSON file; import offers Merge (keep existing) or Replace (restore exactly) mode; page reloads automatically to apply

### Changed
- **Topbar redesign** — search box widened (260→360px, expands to 520px on focus); `⚠ 18` alert count now reads `⚠ 18 alerts` with tooltip and click-to-open; username chip (`👤 admin`) shown in standalone mode after login; button order: notifications → status → refresh | theme → username → Sign Out → `?`; thin separators group functional areas; `?` moved to far right
- **Browser tab title** — now shows current view name (`PCC — Virtual Machines`, `PCC — Disk Health`, etc.) instead of a mix of node names; updates on every navigation
- **Affinity fix dialog** — replaced bare `confirm()` with a proper modal: shows rule type explanation, current violation detail, migration list (VM chip + source node in red → target node in green), live-migration note, and `⚡ Migrate N VMs` confirm button

### Fixed
- **PVE login screen flash on page load** — `view-connect` had no `display:none` so it appeared for ~200-400ms during async backend detection/session verify; now hidden by default and covered by an `#init-overlay` spinner until init completes
- **Datacenter Options tab crash** — `cfg is not defined` error caused by a stray variable name in the Tags section; replaced with correct `o['allowed-tags']` reference (handles both string and array formats); also wires up the tags field so it's saved on submit
- **Datacenter allowed-tags not saved** — `saveDatacenterOptions()` was rendering the tags input but not including it in the PUT request params

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
