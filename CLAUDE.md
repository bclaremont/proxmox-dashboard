# Certus Command Centre (Proxmox VE Dashboard)

> Previously "PCC — Proxmox Command Center". Rebranded to **Certus Command Centre**. JS variables (`PCC_BACKEND`, `PCC_TOKEN`) retain the PCC prefix — do not rename them.

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
- Certus hexagon logo is embedded as a base64 PNG data URI in both `proxmox-dashboard.html` and `console.html` — no external requests at runtime
- `_certusLogoHref` — const that captures the logo data URI at startup; `updateFaviconBadge()` uses it as the canvas base so alert-count badges don't overwrite the logo
- Background colour is `#1a1a2e` (matches dark theme); if the logo is updated, ensure the PNG palette has no near-white entries or it will glow on dark browser chrome

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
