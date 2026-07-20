# PCC — Proxmox Command Center (Proxmox VE Dashboard)

> Briefly rebranded to "Certus Command Centre"; reverted back to **PCC — Proxmox Command Center** per the user's request. The hexagon logo/favicon introduced during that rebrand was kept. JS variables (`PCC_BACKEND`, `PCC_TOKEN`) and the `_certusLogoHref` constant retain their existing names — do not rename them.

## Files
- **Dev repo**: `/opt/proxmox-dashboard/` — only ever edit files here
- **Live instance**: runs on a separate standalone Debian VM in a different building — no direct access
- `proxmox-dashboard.html` — entire dashboard UI and client-side logic (single HTML file, no build step)
- `server/server.js` — Node.js + Express + SQLite backend (standalone mode only)
- `console.html` — noVNC console popup

## Deployment
The live deployment works like this:
1. Edit files in `/opt/proxmox-dashboard/`
2. `git push` to GitHub (`https://github.com/bclaremont/proxmox-dashboard`)
3. User runs `pcc-update` on the standalone Debian VM — it clones the repo, copies files, restarts the `pcc` systemd service
4. **Always push to GitHub after every change** — the user can't get updates any other way

## Test environment
- Proxmox host: 192.168.1.231 (PVE API :8006)
- No local browser-based testing — use `curl` against the live PVE API to verify API calls
- PVE API token stored in `/root/.claude/pve-token` (format: `PVEAPIToken=user@realm!tokenid=<secret>`)

## After every edit
1. Syntax check: `node -e "const fs=require('fs');const h=fs.readFileSync('proxmox-dashboard.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);try{new Function(m[1]);console.log('OK');}catch(e){console.log('ERROR:',e.message);}"`
2. Commit and push to GitHub

## Code conventions
- Always reference official Proxmox API: https://pve.proxmox.com/pve-docs/api-viewer/
- Preserve CSS variable system (`--bg`, `--bg2`, `--bg3`, `--accent`, `--border`, `--text`, `--muted`, etc.)
- All new server-side API routes MUST be added BEFORE the SPA catch-all (`app.get('*', ...)`) in `server.js`
- New views must be added to the `views` array in `switchView()` or they cause a blank page
- `PCC_BACKEND` — client-side boolean, true when Node.js backend detected; gate standalone-only features on this
- `PCC_TOKEN` — JWT in `sessionStorage('pcc-token')`; pass as `Authorization: Bearer` header on API calls
- **Cluster picker**: use `getViewConn(selId)` → `resolveConn()` to get the active connection for a view. Never manually overwrite a `.conn-sel` dropdown's innerHTML — `populateConnSelectors()` owns all of them and will overwrite manual changes

## Favicon
- Hexagon logo is embedded as a base64 PNG data URI in both `proxmox-dashboard.html` and `console.html` — no external requests at runtime
- `_certusLogoHref` — const that captures the logo data URI at startup; `updateFaviconBadge()` uses it as the canvas base so alert-count badges don't overwrite the logo
- Background colour is `#1a1a2e` (matches dark theme); if the logo is updated, ensure the PNG palette has no near-white entries or it will glow on dark browser chrome

## No third-party product references
- Do not use VMware, vSphere, vSAN, vMotion, or similar trademarked terms in any user-facing text, tooltips, comments, or variable names
- QEMU internal values (`vmware` VGA type, `vmxnet3` NIC) must keep their API values but display neutrally (e.g. `vmware` → `svga` in labels)

## Storage view (`view-storage`)
Key helpers:
- `_STOR_TYPES` — map of storage type → `{ label, thin, tip }` — defines THIN/THICK badge and tooltip per type
- `_STOR_CONTENT_META` — map of content type → `{ label, color }` — drives the breakdown bar colours
- `_storEstimateCommitted(node, storage)` — sums `maxdisk` from PVE.vms/PVE.containers as a committed-disk estimate
- `_storMountPoint(s)` — returns human-readable path/VG/pool/server string for a storage object
- `_storContentChips(s)` — returns content-type chip HTML for the storage row
- `_storExpand(node, storage, btn)` — lazy-loads `/storage/{s}/content`, renders usage bar + VM/CT disk/backup chip lists; chips show VM name + total allocated size; `dataset.loaded` prevents re-fetch

## Move Disk (`openMoveDiskModal`)
Moves one or more VM/CT disks to a different storage on the same node.
- `openMoveDiskModal(node, vmid, type, connId)` — fetches VM/CT config, parses disks, shows checkbox list + target storage dropdown
- `_moveDiskCtx` — module-level state holding parsed disks, available storages, and connection info
- `_cfgSizeBytes(s)` — parses config size strings like `80G`, `4M` → bytes
- `_moveDiskGetSelected()` — returns checked disk entries from the modal
- `_moveDiskRefreshTargets()` — updates target storage dropdown when disk selection changes; excludes source storage when all selected disks share one source
- `_moveDiskUpdateWarn()` — shows yellow warning if target will be >85% full after move
- `_executeMoveDisk()` — iterates selected disks, POSTs `move_disk` (VM) or `move_volume` (LXC), registers each UPID with task monitor; skips disks already on target; blocks if CT is running
- APIs: `POST /nodes/{node}/qemu/{vmid}/move_disk`, `POST /nodes/{node}/lxc/{vmid}/move_volume`

## PCC's own 2FA (login) vs the `view-tfa` "2FA" tab
These are two unrelated features that happen to share the name "2FA" — don't conflate them.
- **`view-tfa`** (`loadTFA`, `_pbsRenderOverview`-adjacent code around proxmox-dashboard.html's "2FA MANAGEMENT" section) manages 2FA on the **Proxmox VE cluster's own accounts** via PVE's `/access/tfa` API. It has nothing to do with logging into PCC.
- **PCC's own login 2FA** guards the username/password gate into PCC itself (`server.js` `/api/auth/login`). Added 2026-07 after an audit found PCC's login had no second factor at all.
  - `users.totp_secret` (encrypted with `encryptValue`/`decryptValue`, same as cluster tokens) / `users.totp_enabled` — server-side state
  - `generateTotpSecret()`, `verifyTotp()`, `base32Encode`/`base32Decode`, `totpAt()` in `server.js` — hand-rolled RFC 6238 (SHA1/6-digit/30s, ±1 step drift), no external TOTP dependency by design
  - `POST /api/auth/login` returns `{ mfaRequired: true, pendingToken }` (5min JWT) instead of a session token when `totp_enabled`; `POST /api/auth/login/totp` exchanges `{ pendingToken, code }` for the real session token
  - `POST /api/auth/totp/setup|enable|disable` — self-service, under Admin → My Account (`openEnable2FAModal`/`openDisable2FAModal` in the HTML)
  - `POST /api/users/:id/disable-totp` — admin override for a user who lost their device, in Admin → Users
  - `server/reset-2fa.js` — break-glass CLI for when the *only* admin is locked out (no other admin account to use the UI override from); run on the PCC server itself: `node reset-2fa.js --list` / `node reset-2fa.js <username>`. Documented in SETUP.md under Troubleshooting.

## PBS view (`view-pbs`)
Connects directly to PBS REST API (port 8007), separate from PVE.
- `PBS` — module-level object `{ host, ticket, csrfToken, tokenAuth, useToken, connected }`
- `_pbsData` — cached after load `{ enriched, jobs, tasks, vmMeta }`; cleared on disconnect
- `connectPBS()` — handles password auth (POST `/access/ticket`) or API token auth
- `loadPBS()` — fetches datastores + status + snapshots + jobs + tasks in parallel; builds 4-tab layout
- `_pbsSwitchTab(name)` — switches between Overview / Backups / Jobs / Tasks tabs
- `_pbsRenderOverview()` — stat cards + per-datastore usage bars with last-backup age indicator
- `_pbsRenderBackups()` — groups all snapshots by VM/CT ID across datastores; resolves names from `PVE.vms`/`PVE.containers`; colour-codes last backup age (green <25h, amber <73h, red older)
- `_pbsRenderJobs()` — lists scheduled backup jobs from `GET /api2/json/jobs/backup`
- `_pbsRenderTasks()` — lists recent task history from `GET /api2/json/nodes/localhost/tasks`
- `_pbsRelTime(epochSec)` — "2h ago" / "3d ago" relative timestamp
- `_pbsAgeColor(epochSec)` — returns CSS colour variable based on backup age
- PBS API docs: https://pbs.proxmox.com/docs/api-viewer/

## Log Viewer (`view-logs`)
Three tabs: **System Logs** (`/nodes/{node}/syslog`), **Cluster Events** (`/cluster/log`), **VM/CT Operations** (`/nodes/{node}/tasks`).

Key functions:
- `loadLogs()` — entry point; dispatches to the active tab's load function
- `_logsToggleAutoRefresh()` / `_logsStopAutoRefresh()` — interval-based auto-refresh; timer is cleared in `switchView()` when leaving the logs view
- `_syslogFilteredRows()` / `_clusterFilteredRows()` — shared filter logic used by both render and export functions; add new filter controls here
- `_renderSyslogTable()` / `_renderClusterTable()` — re-render from stored `_syslogEntries` / `_clusterEntries` without re-fetching; call these for filter-only changes
- `_humanizeMsg(service, msg)` — translates kernel boot messages to plain English (System Logs)
- `_humanizeClusterMsg(msg)` — parses UPID task strings into readable start/complete/fail labels (Cluster Events)
- `_exportCsv(headers, rows, filename)` — generic CSV download helper used by both export buttons
- Syslog timestamps have no year; `_syslogTsMs()` infers current year and decrements if the date is in the future (handles Dec/Jan boundary)
