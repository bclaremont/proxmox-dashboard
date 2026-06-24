# Certus Command Centre — Roadmap

Ideas and planned improvements, compiled from all previous sessions. Items are roughly ordered by priority within each section. Check off items as they land in the changelog.

---

## Finish partially-built features

- [ ] **Worldmap** — `div` exists but has no rendering logic; visually show multi-cluster geographic distribution of nodes
- [ ] **PBS Integration** — Proxmox Backup Server view is a skeleton; complete with backup job status, restore points, and datastore usage
- [ ] **Cluster Graphs** — timeframe selector buttons exist; complete the rendering pipeline for full CPU / RAM / network trending over time
- [ ] **Affinity / Anti-affinity rules** — UI exists; backend logic for gang (same node) and spread (different nodes) placement using `/cluster/rules` (PVE 8.1+) or HA group constraints
- [ ] **Host Profiles / desired-state config** — detect config drift by comparing node configs against a baseline profile; highlight differences
- [ ] **VM Customization Specs** — proper template-deploy flow: auto-configure hostname / IP / DNS via cloud-init when deploying from a template

---

## VM & Container operations

- [ ] **Bulk VM/CT operations** — checkbox-select multiple VMs / containers and perform start / stop / snapshot in a single action; table infrastructure is already in place
- [ ] **Maintenance Mode drain** — one-click "evacuate all VMs off this node" before maintenance; iterate VMs on node and migrate each via API
- [ ] **Storage vMotion** — move a VM's disks to a different datastore from the VM detail panel without full migration
- [ ] **CT template loading fix** — CT creation wizard starts but template list doesn't display; investigate and fix the template-fetch flow

---

## Monitoring & alerting

- [ ] **Alert thresholds UI** — backend already stores `pve-alert-thresholds` (consumed by the Overview health banner); add a frontend panel to configure warning / critical thresholds for CPU, RAM, and disk per node or cluster
- [ ] **Per-VM performance alerts** — alert when a specific VM's CPU / RAM exceeds a threshold; current alerts are cluster-wide only
- [ ] **Capacity forecasting** — "time remaining" until CPU / RAM / disk exhausted, projected from RRD linear trend; add to DRS view and Overview
- [ ] **VM metrics sparklines** — per-VM CPU and RAM mini-graphs in the VM table rows, following the same pattern as node sidebar sparklines

---

## Storage

- [ ] **Storage DRS** — auto-balance VMs across datastores by capacity / I/O; build on the existing DRS engine, add storage dimension
- [ ] **Storage detail: mount points** — show the underlying device / mount point (e.g. `/dev/sdb1`) in the storage view
- [ ] **Storage detail: VM/CT usage** — show which VMs and containers are consuming each storage pool
- [ ] **Thin provisioning indicators** — VMware-style overcommit visualisation (thin / thick, overprovisioned warnings) per pool

---

## Log Viewer

- [ ] **Task duration** — calculate start-to-end duration from UPID hex timestamps in Cluster Events; no extra API calls needed
- [ ] **Auto-refresh toggle** — checkbox with 30s / 60s interval for live log monitoring
- [ ] **"Recent ops" default** — load last 50 tasks across all nodes when VM/CT tab opens instead of blank-until-search
- [ ] **Error summary banner** — strip at top of Log Viewer showing error / warn counts from the last hour across all three tabs; click to filter
- [ ] **Task output drill-down** — click a task row to load the full task log from `/nodes/{node}/tasks/{upid}/log`
- [ ] **Group kernel boot messages** — collapse 50+ consecutive kernel INFO rows into "Boot sequence (N messages)" with an expand arrow
- [ ] **Date range filter** — filter syslog and cluster events by a start / end date range
- [ ] **AI log analysis** — parse log entries, surface human-readable summaries, and link to relevant Proxmox KB / community resources

---

## Network topology

- [ ] **Network topology diagram** — visual graph of VMs → bridges → physical NICs per node for a selected cluster; the network view already fetches interface data

---

## Quality-of-life

- [ ] **Keyboard shortcuts cheatsheet** — pressing `?` opens a modal listing all available shortcuts (command palette, refresh, view navigation, etc.)
- [ ] **Density toggle** — compact / comfortable row spacing switch for VM and CT tables
- [ ] **Stat card trend badges** — up / down arrows on Overview stat cards showing change since last refresh
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
