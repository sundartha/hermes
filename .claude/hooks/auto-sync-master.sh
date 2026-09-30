#!/usr/bin/env bash
quiet='{"suppressOutput":true}'
cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || { printf '%s\n' "$quiet"; exit 0; }
git rev-parse --git-dir >/dev/null 2>&1 || { printf '%s\n' "$quiet"; exit 0; }
git fetch upstream --quiet 2>/dev/null
printf '%s\n' "$quiet"
exit 0
