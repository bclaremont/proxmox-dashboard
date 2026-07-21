#!/usr/bin/env bash
# PCC — dumps fail2ban status to a JSON file the unprivileged pcc user can read.
#
# Runs as root via pcc-fail2ban-status.timer (every ~30s). This script only ever
# reads fail2ban's own status output and writes a plain file — it never executes
# anything that mutates fail2ban state (no unban capability here by design, since
# the pcc service itself runs unprivileged and should stay that way).
#
# Install: see SETUP.md "Fail2Ban dashboard status (optional)".

set -euo pipefail

OUTFILE="/opt/pcc/data/fail2ban-status.json"
TMPFILE="$(mktemp)"

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

if ! command -v fail2ban-client >/dev/null 2>&1 || ! systemctl is-active --quiet fail2ban; then
  printf '{"available":false,"generated_at":%s}\n' "$(date +%s)" > "$TMPFILE"
  mv "$TMPFILE" "$OUTFILE"
  chmod 644 "$OUTFILE"
  exit 0
fi

jail_list_line=$(fail2ban-client status 2>/dev/null | grep 'Jail list:' || true)
jails=$(echo "$jail_list_line" | sed 's/.*Jail list:[[:space:]]*//' | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' || true)

jail_json="[]"
if [ -n "$jails" ]; then
  entries=()
  while IFS= read -r jail; do
    [ -z "$jail" ] && continue
    status=$(fail2ban-client status "$jail" 2>/dev/null || true)
    cur_failed=$(echo "$status" | grep 'Currently failed:' | grep -oE '[0-9]+' | head -1)
    tot_failed=$(echo "$status" | grep 'Total failed:'     | grep -oE '[0-9]+' | head -1)
    cur_banned=$(echo "$status" | grep 'Currently banned:' | grep -oE '[0-9]+' | head -1)
    tot_banned=$(echo "$status" | grep 'Total banned:'     | grep -oE '[0-9]+' | head -1)
    ip_line=$(echo "$status" | grep 'Banned IP list:' | sed 's/.*Banned IP list:[[:space:]]*//')
    ip_json="[]"
    if [ -n "$ip_line" ]; then
      ip_json="[$(echo "$ip_line" | tr ' ' '\n' | grep -v '^$' | sed 's/.*/"&"/' | paste -sd, -)]"
    fi
    entries+=("{\"name\":\"$(json_escape "$jail")\",\"currentlyFailed\":${cur_failed:-0},\"totalFailed\":${tot_failed:-0},\"currentlyBanned\":${cur_banned:-0},\"totalBanned\":${tot_banned:-0},\"bannedIPs\":$ip_json}")
  done <<< "$jails"
  jail_json="[$(IFS=,; echo "${entries[*]}")]"
fi

printf '{"available":true,"generated_at":%s,"jails":%s}\n' "$(date +%s)" "$jail_json" > "$TMPFILE"
mv "$TMPFILE" "$OUTFILE"
chmod 644 "$OUTFILE"
