#!/bin/bash
set -eu
HOECHSTDAUER_MIN=240
ISSUE=${1:?Issue}; EIGEN=${2:?eigener Zweig}
REPO_GH=sundartha/hermes; ANSPRUCH=paket/$ISSUE-anspruch; AB=refs/heads/$ANSPRUCH
GLEICH=${EIGEN/#system\//paket/}
FRIST=$((HOECHSTDAUER_MIN * 60))
jetzt() { date +%s; }
zeit() { TZ=UTC git log -1 --date=format-local:%Y-%m-%dT%H:%M:%SZ --format=%cd "$1"; }
besetzt() { echo "Paket #$ISSUE ist in Arbeit: $1" >&2; exit 1; }
erledigt() {
  local N
  N=$(gh pr list -R $REPO_GH --state all --head "$1" --json number --jq length) || { echo "gh pr list gescheitert" >&2; exit 2; }
  [ "$N" -gt 0 ]
}

PRS=$(gh pr list -R $REPO_GH --state open --limit 200 --json number,headRefName,body) || { echo "gh pr list gescheitert" >&2; exit 2; }
FREMDE=$(printf '%s' "$PRS" | jq -r --arg i "$ISSUE" --arg e "$EIGEN" '.[] | select(.headRefName != $e) | select((.headRefName | startswith("paket/" + $i + "-") or startswith("system/" + $i + "-")) or ((.body // "") | test("(Refs|Closes|Teil von) #" + $i + "([^0-9A-Za-z_]|$)"))) | "PR #\(.number) (\(.headRefName))"' | head -1)
[ -z "$FREMDE" ] || besetzt "$FREMDE"

git fetch -q hermes master
while read -r SHA REF; do
  [ -n "${REF:-}" ] || continue
  ZWEIG=${REF#refs/heads/}
  [ "$ZWEIG" != "$ANSPRUCH" ] && [ "${ZWEIG/#system\//paket/}" != "$GLEICH" ] || continue
  erledigt "$ZWEIG" && continue
  git fetch -q hermes "$REF"
  ALTER=$(( $(jetzt) - $(git log -1 --format=%ct "$SHA") ))
  [ "$ALTER" -ge "$FRIST" ] || besetzt "Zweig $ZWEIG, letzter Commit $(zeit "$SHA")"
done < <(git ls-remote hermes "refs/heads/paket/$ISSUE-*" "refs/heads/system/$ISSUE-*")

master_sha() {
  local M
  M=$(git ls-remote hermes refs/heads/master | cut -f1)
  [ -n "$M" ] || return 1
  git fetch -q hermes master || return 1
  echo "$M"
}
anlegen() {
  local ALT=$1 NEU M
  M=$(master_sha) || return 3
  NEU=$(git commit-tree "$M^{tree}" -p "$M" -m "Anspruch #$ISSUE von $EIGEN $(date -u +%Y-%m-%dT%H:%M:%SZ)")
  [ -n "$NEU" ] || return 3
  git push -q --force-with-lease=$AB:$ALT hermes $NEU:$AB 2>/dev/null
}
auswerten() {
  local SHA
  SHA=$(git ls-remote hermes $AB | cut -f1)
  if [ -z "$SHA" ]; then
    anlegen "" && return 0
    return 3
  fi
  git fetch -q hermes $AB
  local S=$(git log -1 --format=%s "$SHA") A=$(( $(jetzt) - $(git log -1 --format=%ct "$SHA") ))
  S=${S#Anspruch \#$ISSUE von }; S=${S% *}
  [ "$S" != "$EIGEN" ] || return 0
  [ "$A" -ge "$FRIST" ] || erledigt "$S" || besetzt "$S seit $(zeit "$SHA")"
  anlegen "$SHA" && return 0
  return 3
}
auswerten && exit 0
auswerten && exit 0
echo "Anspruch auf #$ISSUE nicht zu setzen" >&2; exit 2
