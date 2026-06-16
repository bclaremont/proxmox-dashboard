# Proxmox VE Dashboard (PCC — Proxmox Command Center)

## Files
- **Dev repo**: `/opt/proxmox-dashboard/` — only ever edit files here
- **Static test serve**: `/var/www/proxmox-dashboard/index.html` — copy here after every edit
- **Live PCC**: runs on a separate standalone Debian VM in a different building — no direct access
- `proxmox-dashboard.html` — entire dashboard UI and client-side logic (single HTML file, no build step)
- `server/server.js` — Node.js + Express + SQLite backend (standalone mode only)
- `console.html` — noVNC console popup

## Deployment
**NEVER edit `/opt/pcc/` — it is a stale irrelevant copy on this test host.**

The live deployment works like this:
1. Edit files in `/opt/proxmox-dashboard/`
2. Copy HTML to `/var/www/proxmox-dashboard/index.html` (for local testing)
3. `git push` to GitHub (`https://github.com/bclaremont/proxmox-dashboard`)
4. User runs `pcc-update` on the standalone Debian VM — it clones the repo, copies files, restarts the `pcc` systemd service
5. **Always push to GitHub after every change** — the user can't get updates any other way

## Test environment
- Proxmox host: 172.16.110.221 (nginx proxy :8080, PVE API :8006)
- After editing `proxmox-dashboard.html`, always copy to `/var/www/proxmox-dashboard/index.html`

## After every edit
1. Copy: `cp proxmox-dashboard.html /var/www/proxmox-dashboard/index.html`
2. Syntax check: `node -e "const fs=require('fs');const h=fs.readFileSync('proxmox-dashboard.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);try{new Function(m[1]);console.log('OK');}catch(e){console.log('ERROR:',e.message);}"`
3. Commit and push to GitHub

## Code conventions
- Always reference official Proxmox API: https://pve.proxmox.com/pve-docs/api-viewer/
- Preserve CSS variable system (`--bg`, `--bg2`, `--bg3`, `--accent`, `--border`, `--text`, `--muted`, etc.)
- All new server-side API routes MUST be added BEFORE the SPA catch-all (`app.get('*', ...)`) in `server.js`
- New views must be added to the `views` array in `switchView()` or they cause a blank page
- `PCC_BACKEND` — client-side boolean, true when Node.js backend detected; gate standalone-only features on this
- `PCC_TOKEN` — JWT in `sessionStorage('pcc-token')`; pass as `Authorization: Bearer` header on API calls
