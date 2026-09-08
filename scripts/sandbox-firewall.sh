#!/usr/bin/env bash
# Run on the Linux Docker host (Docker Engine 28+, iptables backend).
# Internal isolated per-instance bridges are named sg<11 hex characters>.
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'Run with sudo on the Docker host'; exit 1; }
modprobe br_netfilter
sysctl -w net.bridge.bridge-nf-call-iptables=1
iptables -nL DOCKER-USER >/dev/null
add_rule() { local chain=$1; shift; iptables -C "$chain" "$@" 2>/dev/null || iptables -I "$chain" 1 "$@"; }
# Existing replies to inbound player traffic are allowed; new connections are blocked.
for slot in $(seq 0 50); do
  add_rule DOCKER-USER -i 'sg+' -s "172.30.$slot.3" -m conntrack --ctstate NEW,INVALID -j DROP
done
add_rule INPUT -i 'sg+' -m conntrack --ctstate NEW,INVALID -j DROP
echo 'Sandbox egress blocked. Persist these rules and reapply after Docker/firewall restarts.'
