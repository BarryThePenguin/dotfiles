#!/usr/bin/env bash
# Regression test for the net:check diagnosis logic in
# .config/mise/tasks/net.toml.
#
# Guards the 2026-10-13 bug: the resolver probe grepped `scutil --dns` for
# "DNS configuration" -- a substring of the *absence* message "No DNS
# configuration available" -- so a total resolver loss read resolver=ok; the
# diagnosis tree then called it OFF-NETWORK (Wi-Fi down) even while WAN egress
# and the default route were proven up. Nothing else tests this: the repo's
# hk linters are JS-only, and shellcheck cannot see a logic error.
#
# The probes are shell commands, so each case shims them on PATH and runs the
# real task. Hermetic: no cluster, no network.
set -uo pipefail

shimdir="$(mktemp -d)"
trap 'rm -rf "$shimdir"' EXIT

shim() { # shim <name> <body>
  { printf '#!/bin/sh\n'; printf '%s\n' "$2"; } >"$shimdir/$1"
  chmod +x "$shimdir/$1"
}

# Default: no clusters (get-contexts is empty -> the loop skips every
# context), so the task never reaches a real apiserver. Cases override the
# probes they care about.
shim kubectl 'case "$1" in config) exit 0 ;; esac; exit 0'

fail=0
assert() { # assert <case-name> <needle>...
  name="$1"; shift
  out="$(PATH="$shimdir:$PATH" mise run net:check 2>&1)"
  bad=0
  for needle in "$@"; do
    printf '%s' "$out" | grep -qF -- "$needle" || { bad=1; printf '  FAIL  %s -- missing: %s\n' "$name" "$needle"; }
  done
  if [ "$bad" = 0 ]; then
    printf '  ok    %s\n' "$name"
  else
    printf '%s\n' "$out" | sed 's/^/        | /'
    fail=1
  fi
}

# --- healthy laptop -------------------------------------------------------
shim scutil 'printf "DNS configuration\nresolver #1\n"'
shim dscacheutil 'echo "ip_address: 1.2.3.4"'
shim dig 'echo 1.2.3.4'
shim curl 'echo 200'
shim route 'exit 0'
assert "healthy" "resolver=ok route=up" "diagnosis: laptop healthy"

# --- resolver lost (the false-OK trap) ------------------------------------
# scutil's absence message CONTAINS "DNS configuration"; the probe must still
# read fail, and the diagnosis must be LAPTOP SLEPT -- not OFF-NETWORK.
shim scutil 'echo "No DNS configuration available"'
shim dscacheutil 'exit 0'
shim dig 'echo 1.2.3.4'
shim curl 'echo 200'
shim route 'exit 0'
assert "resolver lost" "resolver=fail route=up" "diagnosis: LAPTOP SLEPT"

# --- off-network (resolver configured, but no default route) --------------
shim scutil 'printf "DNS configuration\nresolver #1\n"'
shim dscacheutil 'exit 0'
shim dig 'exit 0'
shim curl 'exit 0'
shim route 'exit 1'
assert "off-network" "route=down" "diagnosis: OFF-NETWORK"

if [ "$fail" = 0 ]; then echo "net:check test: PASS"; else echo "net:check test: FAIL"; fi
exit "$fail"
