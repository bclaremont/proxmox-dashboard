# Certus Command Centre — Roadmap

Ideas and planned improvements. Items are roughly ordered by priority within each section. Check off items as they land in the changelog.

---

## Finish partially-built features

- [ ] **Worldmap** — `div` exists but has no rendering logic; should visually show multi-cluster geographic distribution of nodes
- [ ] **PBS Integration** — Proxmox Backup Server view is a skeleton; complete with backup job status, restore points, and datastore usage
- [ ] **Cluster Graphs** — timeframe selector buttons exist; complete the rendering pipeline for full CPU / RAM / network trending over time

---

## New features

- [ ] **Alert thresholds UI** — backend already stores `pve-alert-thresholds` (and the Overview health banner consumes them); add a frontend panel to configure warning / critical thresholds for CPU, RAM, and disk per node or per cluster
- [ ] **Bulk VM/CT operations** — checkbox-select multiple VMs / containers and perform start / stop / snapshot in a single action; table infrastructure is already in place
- [ ] **Network topology diagram** — visual graph of VMs → bridges → physical NICs per node for a selected cluster; the network view already fetches the interface data
- [ ] **VM metrics sparklines** — per-VM CPU and RAM mini-graphs in the VM table rows, following the same pattern as the node sidebar sparklines added in the UX pass

---

## Quality-of-life

- [ ] **Keyboard shortcuts cheatsheet** — pressing `?` opens a modal listing all available shortcuts (command palette, refresh, view navigation, etc.)
- [ ] **Mobile layout pass** — audit and fix layout breakpoints so the dashboard is usable on a phone or small tablet

---

## Completed

See [CHANGELOG.md](CHANGELOG.md) for everything that has shipped.
