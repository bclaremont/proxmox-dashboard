# PCC — Roadmap

Ideas and planned improvements, compiled from all previous sessions. Items are roughly ordered by priority within each section. Check off items as they land in the changelog.

---

## Finish partially-built features

- [x] **Worldmap** — `div` exists but has no rendering logic; visually show multi-cluster geographic distribution of nodes
- [-] **PBS Integration** — view built (Overview / Backups / Jobs / Tasks tabs, VM name resolution, job schedule, task history); untested — no PBS instance available to verify
- [x] **Cluster Graphs** — `loadClusterGraphs()` full Chart.js pipeline for CPU/Mem/NetIn/NetOut/IOwait/DiskRead per node, timeframe + per-node/overlay selector, PNG/CSV export
- [x] **Affinity / Anti-affinity rules** — gang/spread placement enforcement (`checkRule`/`enforceRule`/`enforceAllRules`) via localStorage-stored rules and live migration; not PVE's native `/cluster/rules` API (unavailable pre-8.1) but functionally complete
- [x] **Host Profiles / desired-state config** — `runComplianceCheck()` compares DNS/timezone per node against a captured baseline, flags drift, one-click `applyProfileToNode` fix
- [x] **VM Customization Specs** — Customisation Specs view + modal; hostname/domain/network/DNS/user/SSH key templates applied via cloud-init on clone/deploy

---

## VM & Container operations

- [x] **Bulk VM/CT operations** — checkbox-select multiple VMs / containers and perform start / stop / snapshot in a single action; table infrastructure is already in place
- [x] **Maintenance Mode drain** — drain modal migrates all VMs/CTs off a node, handles local-storage targetstorage mapping, live progress log, sets `pve-maintenance-nodes` flag
- [x] **Move Disk** — move one or more VM/CT disks to a different storage from the VM row (⇄ button); supports multi-disk selection, running-CT guard, post-move fill warning
- [x] **CT template loading fix** — CT creation wizard now scopes templates and default storage to the target node
- [ ] **VM grouping (application stacks)** — tag VMs as part of a named group (e.g. "GitLab" = 3 VMs) and start / stop / snapshot the entire group as a unit; resource Pools view exists (add/remove members, per-VM actions) but no bulk group-lifecycle actions
- [x] **Resource pools** — full `/pools` CRUD surfaced (list, create, edit, delete, add/remove members, per-cluster grouping); doesn't show a combined shared CPU/RAM ceiling
- [x] **VM notes / annotations** — read and write the PVE description field (`/nodes/{node}/qemu/{vmid}/config → description`) inline from the VM detail panel; useful for documenting purpose, owner, maintenance windows
- [ ] **Scheduled tasks calendar** — unified view of all scheduled backups, snapshot jobs, and vzdump schedules across nodes; show as a calendar or timeline so clashing windows are obvious

---

## Monitoring & alerting

- [x] **Alert thresholds UI** — backend already stores `pve-alert-thresholds` (consumed by the Overview health banner); configure warning / critical thresholds for CPU, RAM, disk, certs, vmDown, and taskError from the ⚙ Settings modal
- [x] **Per-VM performance alerts** — per-VM/CT rules (CPU/RAM/disk threshold + sustained duration) configurable via ⚡ VM Rules; fires notifications and shows a ⚠ badge on the VM row while a rule is actively breached
- [x] **Anomaly badges on VM rows** — small ↑ badge on the VM name when current CPU/RAM is significantly above that VM's own rolling average from the sparkline history; tooltip shows the spike detail (inspired by Nutanix Prism anomaly detection)
- [ ] **VM efficiency buckets** — classify every VM into Bully (resource hog), Constrained (hitting ceiling), Over-provisioned (large allocation, low usage), or Inactive (off 30+ days); show as a colour-coded summary card on Overview or DRS view
- [x] **Capacity runway** — "Node X: ~14 days until RAM full at current growth rate"; per-node and per-storage projected days-to-full from RRD linear trend; surface on Overview stat cards and DRS view
- [ ] **"VM last seen online" tracker** — for stopped VMs, show when they last ran using task history; surface as a column or tooltip in the VM table so long-idle VMs are visible
- [x] **VM metrics sparklines** — per-VM CPU and RAM mini-graphs in the VM table rows, following the same pattern as node sidebar sparklines

---

## Storage

- [x] **Storage DRS** — Storage DRS tab on DRS view; datastore utilisation table with gauge bars, disk-move recommendations (overfull → underfull), execute via `move_disk`/`move_volume`, configurable thresholds
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
- [-] **AI log analysis** — `_analyzeLog()` + `LOG_PATTERNS` (22 regex rules) gives human-readable explain/fix text and Proxmox Forum/Wiki links; static pattern-matching, not actual LLM-based analysis

---

## Network topology

- [ ] **Network topology diagram** — visual graph of VMs → bridges → physical NICs per node for a selected cluster; the network view already fetches interface data

---

## Quality-of-life

- [x] **Quick filter chips above VM table** — one-click pills (Running / Stopped / High CPU / Anomaly) that instantly filter the VM and CT lists with live counts; zero extra API calls
- [x] **Heatmap view** — colour-coded tile grid of all VMs by chosen metric (CPU, RAM, disk); each VM is a tile, colour ranges green→red; metric selector + stopped toggle; node resource cards above the tile grid
- [x] **Snapshot timeline** — Timeline tab in the Snapshots view; per-VM horizontal row of dots positioned by real snapshot date on a shared time axis, amber for >30 days old, larger dot for RAM-state snapshots
- [x] **Node update tracker** — pending package count badge per node (amber/red for security); version drift detection highlights minority PVE versions in amber; cached 5 min, works across multi-cluster
- [ ] **Custom columns** — let users show/hide and reorder columns in the VM/CT table (e.g. hide Disk, add IP, add last-backup age)
- [x] **Right-click context menu on VM rows** — right-click any VM/CT row for a fast context menu (power, console, open detail, migrate, move disk, clone, performance, snapshot, pin); works on main table and Overview table; dismisses on click-outside / Escape / scroll
- [x] **Keyboard shortcuts cheatsheet** — pressing `?` opens a modal listing all available shortcuts (command palette, refresh, view navigation, etc.)
- [x] **Density toggle** — `toggleDensity()` compact/comfortable row spacing switch, persisted in localStorage
- [x] **Stat card trend badges** — up / down arrows on Overview stat cards showing change since last refresh
- [x] **VM grid view: separate by cluster** — `_renderVMCardsGrouped()` groups grid view by cluster with per-cluster header bars, matching list view
- [-] **Mobile layout pass** — one `@media` breakpoint (900px) collapses sidebar and full-screens detail panel; no broader phone-sized breakpoint audit

---

## Longer-term / complex

- [ ] **Site Recovery Manager equivalent** — full DR orchestration: failover runbooks, test-failover mode
- [-] **Content Library** — Content Library view (`loadContentLibrary`) catalogs VM/CT templates and ISOs across clusters; no versioning or check-in/check-out workflow yet
- [ ] **Storage Policy-Based Management** — per-VM storage policies (thin / thick, replication level)
- [ ] **Kubernetes integration** — surface k8s workloads running on Proxmox nodes

---

## Completed

See [CHANGELOG.md](CHANGELOG.md) for everything that has shipped.
