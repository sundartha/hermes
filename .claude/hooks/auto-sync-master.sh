#!/usr/bin/env bash
# SessionStart-Hook: master automatisch mit origin/master synchronisieren.
# Safe-by-default: NUR fast-forward, nie Merge bei Divergenz, nie Working-Tree zerstoeren.
# Stilles No-op ausserhalb von master, bei ff-Konflikt mit lokalen Aenderungen, oder offline.
# Kein blind 'git pull' -> kein versehentlicher Merge-Commit, keine Konflikt-Marker im Tree.

repo="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$repo" 2>/dev/null || { printf '{"suppressOutput":true}\n'; exit 0; }

# Nur in einem Git-Repo arbeiten
git rev-parse --git-dir >/dev/null 2>&1 || { printf '{"suppressOutput":true}\n'; exit 0; }

# Nur auf master auto-syncen; Feature-Branches und detached HEAD nie anfassen
branch="$(git symbolic-ref --short -q HEAD)"
[ "$branch" = "master" ] || { printf '{"suppressOutput":true}\n'; exit 0; }

# Fetch; Hook-Timeout begrenzt Haengen bei langsamem/fehlendem Netz
git fetch origin master --quiet 2>/dev/null || { printf '{"suppressOutput":true}\n'; exit 0; }

local_rev="$(git rev-parse @ 2>/dev/null)"
remote_rev="$(git rev-parse origin/master 2>/dev/null)"

# Schon synchron -> nichts zu tun
if [ "$local_rev" = "$remote_rev" ]; then
  printf '{"suppressOutput":true}\n'
  exit 0
fi

# Fast-forward nur wenn lokaler HEAD echter Ancestor von origin/master ist
if git merge-base --is-ancestor "$local_rev" "$remote_rev" 2>/dev/null; then
  if git merge --ff-only origin/master --quiet 2>/dev/null; then
    n="$(git rev-list --count "${local_rev}..${remote_rev}" 2>/dev/null)"
    printf '{"systemMessage":"Auto-Sync: %s Commit(s) von origin/master gezogen (fast-forward)."}\n' "$n"
    exit 0
  fi
  # ff scheiterte (z.B. untracked File kollidiert mit eingehendem) -> kein Eingriff
  printf '{"systemMessage":"Auto-Sync uebersprungen: fast-forward blockiert (lokale Aenderungen kollidieren). Manuell: git pull --ff-only"}\n'
  exit 0
fi

# Divergiert: lokale Commits nicht auf origin -> NIE auto-mergen
printf '{"systemMessage":"Auto-Sync uebersprungen: master divergiert von origin/master (lokale Commits). Manuell pruefen: git log origin/master..HEAD"}\n'
exit 0
