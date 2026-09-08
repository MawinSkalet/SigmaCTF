#!/bin/sh
set -eu
remaining=$((EXPIRES_EPOCH - $(date +%s)))
[ "$remaining" -gt 0 ] || exit 0
exec timeout --signal=TERM --kill-after=1 "$remaining" apache2 -D FOREGROUND
