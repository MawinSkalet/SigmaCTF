#!/bin/sh
set -eu
export APACHE_LOG_DIR=/tmp
remaining=$((EXPIRES_EPOCH - $(date +%s)))
[ "$remaining" -gt 0 ] || exit 0
exec timeout --signal=TERM --kill-after=1 "$remaining" apache2 -D FOREGROUND
