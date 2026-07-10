# Certus Command Centre — Roadmap

Ideas and planned improvements, compiled from all previous sessions. Items are roughly ordered by priority within each section. Check off items as they land in the changelog.

---

## Finish partially-built features

- [x] **Worldmap** — `div` exists but has no rendering logic; visually show multi-cluster geographic distribution of nodes
- [-] **PBS Integration** — view built (Overview / Backups / Jobs / Tasks tabs, VM name resolution, job schedule, task history); untested — no PBS instance available to verify
- [ ] **Cluster Graphs** — timeframe selector buttons exist; complete the rendering pipeline for full CPU / RAM / network trending over time
- [ ] **Affinity / Anti-affinity rules** — UI exists; backend logic for gang (same node) and spread (different nodes) placement using `/cluster/rules` (PVE 8.1+) or HA group constraints
- [ ] **Host Profiles / desired-state config** — detect config drift by comparing node configs against a baseline profile; highlight differences
- [ ] **VM Customization Specs** — proper template-deploy flow: auto-configure hostname / IP / DNS via cloud-init when deploying from a template

---

## VM & Container operations

- [x] **Bulk VM/CT operations** — checkbox-select multiple VMs / containers and perform start / stop / snapshot in a single action; table infrastructure is already in place
- [ ] **Maintenance Mode drain** — one-click "evacuate all VMs off this node" before maintenance; iterate VMs on node and migrate each via API; extend with a guided checklist (migrate → verify HA → update → reboot → reinstate)
- [x] **Move Disk** — move one or more VM/CT disks to a different storage from the VM row (⇄ button); supports multi-disk selection, running-CT guard, post-move fill warning
- [x] **CT template loading fix** — CT creation wizard now scopes templates and default storage to the target node
- [ ] **VM grouping (application stacks)** — tag VMs as part of a named group (e.g. "GitLab" = 3 VMs) and start / stop / snapshot the entire group as a unit; stored in PVE resource pools or tag convention
- [ ] **Resource pools** — surface PVE resource pools (`/pools`) in the dashboard; show which VMs belong to each pool and their shared CPU/RAM ceiling; allow moving VMs between pools
- [x] **VM notes / annotations** — read and write the PVE description field (`/nodes/{node}/qemu/{vmid}/config → description`) inline from the VM detail panel; useful for documenting purpose, owner, maintenance windows
- [ ] **Scheduled tasks calendar** — unified view of all scheduled backups, snapshot jobs, and vzdump schedules across nodes; show as a calendar or timeline so clashing windows are obvious

---

## Monitoring & alerting

- [x] **Alert thresholds UI** — backend already stores `pve-alert-thresholds` (consumed by the Overview health banner); configure warning / critical thresholds for CPU, RAM, disk, certs, vmDown, and taskError from the ⚙ Settings modal
- [ ] **Per-VM performance alerts** — alert when a specific VM's CPU / RAM exceeds a threshold; current alerts are cluster-wide only
- [x] **Anomaly badges on VM rows** — small ↑ badge on the VM name when current CPU/RAM is significantly above that VM's own rolling average from the sparkline history; tooltip shows the spike detail (inspired by Nutanix Prism anomaly detection)
- [ ] **VM efficiency buckets** — classify every VM into Bully (resource hog), Constrained (hitting ceiling), Over-provisioned (large allocation, low usage), or Inactive (off 30+ days); show as a colour-coded summary card on Overview or DRS view
- [ ] **Capacity runway** — "Node X: ~14 days until RAM full at current growth rate"; per-node and per-storage projected days-to-full from RRD linear trend; surface on Overview stat cards and DRS view
- [ ] **"VM last seen online" tracker** — for stopped VMs, show when they last ran using task history; surface as a column or tooltip in the VM table so long-idle VMs are visible
- [x] **VM metrics sparklines** — per-VM CPU and RAM mini-graphs in the VM table rows, following the same pattern as node sidebar sparklines

---

## Storage

- [ ] **Storage DRS** — auto-balance VMs across datastores by capacity / I/O; build on the existing DRS engine, add storage dimension
- [x] **Datastore browser** — browse, download, and delete files on a storage pool via `/nodes/{node}/storage/{storage}/content`; 📂 Browse button on each storage row opens a modal with type filter chips, size totals, orphaned disk image detection, and per-item delete
- [x] **Consolidated snapshot manager** — dedicated Snapshots view; fetches all snapshots across every VM and CT in parallel; sortable by age/name; summary cards (total, VMs with snaps, 30-day-old count, RAM-state count); per-row Rollback and Delete; old snapshots highlighted amber
- [x] **Storage detail: mount points** — shows underlying path / VG / pool / server for each storage type
- [x] **Storage detail: VM/CT usage** — expand panel shows which VMs and containers have disks or backups on each storage, with size per VM
- [x] **Thin provisioning indicators** — THIN/THICK badges, overcommit warning, committed vs used cards per storage pool

---

## Log Viewer

- [x] **Task duration** — calculate start-to-end duration from UPID hex timestamps in Cluster Events; no extra API calls needed
- [x] **Auto-refresh toggle** — 30s / 1 min / 2 min interval selector for live log monitoring
- [x] **"Recent ops" default** — load last 50 tasks across all nodes when VM/CT tab opens instead of blank-until-search
- [x] **Error summary banner** — strip at top of Log Viewer showing error / warn counts across loaded syslog and cluster event data
- [x] **Task output drill-down** — click a task row to load the full task log from `/nodes/{node}/tasks/{upid}/log`
- [ ] **Group kernel boot messages** — collapse 50+ consecutive kernel INFO rows into "Boot sequence (N messages)" with an expand arrow
- [x] **Date range filter** — datetime range inputs on syslog and cluster events tabs with CSV export
- [ ] **AI log analysis** — parse log entries, surface human-readable summaries, and link to relevant Proxmox KB / community resources

---

## Network topology

- [ ] **Network topology diagram** — visual graph of VMs → bridges → physical NICs per node for a selected cluster; the network view already fetches interface data

---

## Quality-of-life

- [x] **Quick filter chips above VM table** — one-click pills (Running / Stopped / High CPU / Anomaly) that instantly filter the VM and CT lists with live counts; zero extra API calls
- [x] **Heatmap view** — colour-coded tile grid of all VMs by chosen metric (CPU, RAM, disk); each VM is a tile, colour ranges green→red; metric selector + stopped toggle; node resource cards above the tile grid
- [ ] **Snapshot timeline** — horizontal visual timeline per VM showing when snapshots were taken and how old/large they are; makes snapshot age obvious at a glance
- [x] **Node update tracker** — pending package count badge per node (amber/red for security); version drift detection highlights minority PVE versions in amber; cached 5 min, works across multi-cluster
- [ ] **Custom columns** — let users show/hide and reorder columns in the VM/CT table (e.g. hide Disk, add IP, add last-backup age)
- [x] **Right-click context menu on VM rows** — right-click any VM/CT row for a fast context menu (power, console, open detail, migrate, move disk, clone, performance, snapshot, pin); works on main table and Overview table; dismisses on click-outside / Escape / scroll
- [ ] **Keyboard shortcuts cheatsheet** — pressing `?` opens a modal listing all available shortcuts (command palette, refresh, view navigation, etc.)
- [ ] **Density toggle** — compact / comfortable row spacing switch for VM and CT tables
- [x] **Stat card trend badges** — up / down arrows on Overview stat cards showing change since last refresh
- [ ] **VM grid view: separate by cluster** — grid view should group VMs by cluster the same way the list view does
- [ ] **Mobile layout pass** — audit and fix layout breakpoints so the dashboard is usable on a phone or small tablet

---

## Longer-term / complex

- [ ] **Site Recovery Manager equivalent** — full DR orchestration: failover runbooks, test-failover mode
- [ ] **Content Library** — versioned template repository with check-in / check-out workflow
- [ ] **Storage Policy-Based Management** — per-VM storage policies (thin / thick, replication level)
- [ ] **Kubernetes integration** — surface k8s workloads running on Proxmox nodes

---

## Completed

See [CHANGELOG.md](CHANGELOG.md) for everything that has shipped.
