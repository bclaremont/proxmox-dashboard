# Proxmox VE Dashboard

Single HTML file: proxmox-dashboard.html
Served by nginx from: /var/www/proxmox-dashboard/index.html
Proxmox host: 172.16.110.221 (nginx proxy :8080, PVE API :8006)
Always reference official API: https://pve.proxmox.com/pve-docs/api-viewer/
All new scripts need example comments at top.
Preserve CSS variable system (--bg, --bg2, --bg3, --accent etc).
After every edit, copy to: /var/www/proxmox-dashboard/index.html
Test JS syntax with: node -e "const fs=require('fs');const h=fs.readFileSync('proxmox-dashboard.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);try{new Function(m[1]);console.log('OK');}catch(e){console.log('ERROR:',e.message);}"
