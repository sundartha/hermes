#!/bin/zsh
# Test zu lesung() in paket.sh: ein Review mit Änderungswunsch am aktuellen Kopf ist eine FAIL-Lesung, auch wenn für den Kopf schon ein LESUNG OK am PR steht (PR 4410, 15.11.). Rot, wenn es übergangen wird.
D=${0:A:h}; F=${1:-$D/paket.sh}
eval "$(grep '^lesung()' $F | sed 's/   # .*//')"
nachtrag() { echo "2026-11-14T00:00:00Z"; }
J='{"comments":[{"createdAt":"2026-11-15T12:00:35Z","body":"LESUNG OK 714e084 ae41fb9d\n\nkeine MUSS"}],"reviews":[{"state":"CHANGES_REQUESTED","submittedAt":"2026-11-15T13:39:11Z","commit":{"oid":"714e084aaaaaaaa"},"body":"MUSS: x"}]}'
gh() { local q; while [ $# -gt 0 ]; do [ "$1" = --jq ] && q=$2; shift; done; print -r -- "$J" | jq -r "$q"; }
fehler=0
pruefe() { [[ "$2" == ${~3} ]] && echo "ok   $1" || { echo "ROT  $1: '${2:0:60}'"; fehler=1; }; }
pruefe "Review-FAIL nach altem LESUNG OK wird FAIL" "$(lesung 1 714e084 ae41fb9d)" "FAIL 714e084 ae41fb9d:*MUSS: x*"
J=${J/CHANGES_REQUESTED/DISMISSED}
pruefe "zurückgenommenes Review zählt nicht" "$(lesung 1 714e084 ae41fb9d)" "LESUNG OK 714e084 ae41fb9d*"
J=${J/DISMISSED/CHANGES_REQUESTED}; J=${J/714e084aaaaaaaa/999aaaaaaaaaaaa}
pruefe "Review auf anderem Kopf zählt nicht" "$(lesung 1 714e084 ae41fb9d)" "LESUNG OK 714e084 ae41fb9d*"
exit $fehler
