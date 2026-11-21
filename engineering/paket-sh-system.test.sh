#!/bin/zsh
# Verhaltenstest zu paket.sh (Rücklauf-Stelle): Liegt der PR eines Häppchens auf system/<name>, findet die Kette den Worktree paket-<name> (Branch paket/<name>) wie bei paket/<name>. Die Stelle wird aus paket.sh selbst gelesen, nicht nachgebaut.
S=${1:-${0:A:h}/paket.sh}
T=$(mktemp -d); fehler=0
REPO=$T/repo; mkdir -p $REPO && git -C $REPO init -q -b master && git -C $REPO commit -q --allow-empty -m a
git -C $REPO worktree add -q $T/wt-x1 -b paket/x1 >/dev/null
STELLE=$(grep -o 'LB=\$B; \[\[ \$B == [a-z]*/\* \]\] && LB=paket/\${B#system/}; WT=[^#]*' $S | head -1)
[ -n "$STELLE" ] || { echo "ROT  Stelle nicht in paket.sh gefunden"; exit 1; }
suche() { B=$1 eval "$STELLE"; echo "$WT"; }
pruefe() { [[ "$2" == "$3" ]] && echo "ok   $1" || { echo "ROT  $1: '$2' != '$3'"; fehler=1; }; }
W=$(cd $T/wt-x1 && pwd -P)
pruefe "PR auf paket/x1 findet den Worktree" "$(suche paket/x1)" "$W"
pruefe "PR auf system/x1 findet denselben Worktree" "$(suche system/x1)" "$W"
pruefe "fremder Zweig findet keinen Worktree" "$(suche andere/x1)" ""
# Geschlossener PR ohne Merge: Merge-Schleife und Selbstneustart-Wartender warten nicht 60 bzw. 15 Minuten, sondern gehen weiter (4178, 17.11.). Beide Stellen werden aus paket.sh gelesen.
SCHLEIFE=$(grep -o 'prj \$PR; S=\$PRS; \[ "\$S" = MERGED \] && break; \[ "\$S" = CLOSED \] && {[^}]*}' $S | head -1)
[ -n "$SCHLEIFE" ] || { echo "ROT  Schleifenstelle fuer CLOSED nicht in paket.sh gefunden"; exit 1; }
runde() { PRS=$1; LOG=$T; PR=9; prj() { :; }; for _ in 1 2; do echo runde; for _ in 1 2; do eval "$SCHLEIFE"; echo durch; done; echo ende; done; }
pruefe "geschlossener PR springt in die naechste Runde" "$(runde CLOSED | tr '\n' ' ')" "runde runde "
pruefe "offener PR bleibt in der Schleife" "$(runde OPEN | tr '\n' ' ')" "runde durch durch ende runde durch durch ende "
pruefe "gemergter PR verlaesst die Merge-Schleife" "$(runde MERGED | tr '\n' ' ')" "runde ende runde ende "
WARTER=$(grep -o 'case "${Q% \*}" in MERGED|CLOSED) break ;; esac' $S | head -1)
pruefe "Wartender endet auch bei CLOSED" "$([ -n "$WARTER" ] && echo ja)" "ja"
# Übersprungen-Zweig (bau-$N übersprungen): freigeben greift bei rotem Kopf nie, ohne Obergrenze läuft die while-Schleife endlos (PR 5311, Kette #5006, 19.11.). Ab der vierten Runde in Folge auf demselben Kopf hält die Kette statt weiterzudrehen.
UEBER=$(grep -o 'echo "bau-\$N übersprungen[^#]*' $S | head -1)
[ -n "$UEBER" ] || { echo "ROT  Übersprungen-Stelle nicht in paket.sh gefunden"; exit 1; }
runde_ueber() { LOG=$T/ueber-$1; rm -rf $LOG; mkdir -p $LOG; PR=5311; PRK=$1; freigeben() { :; }; einstufung() { echo "sonnet -"; }
  for _ in 1 2 3 4 5; do ( eval "$UEBER" ) 2>/dev/null; [ -s $LOG/halt.txt ] && { echo halt; return; }; echo weiter; done; }
pruefe "gleicher roter Kopf haelt nach 3 Runden statt endlos weiterzudrehen" "$(runde_ueber kopfA)" "weiter
weiter
weiter
halt"
pruefe "neuer Kopf setzt den Zaehler zurueck" "$(LOG=$T/ueber-neu; rm -rf $LOG; mkdir -p $LOG; PR=5311; freigeben() { :; }; einstufung() { echo "sonnet -"; }; for k in a a a b; do PRK=$k; ( eval "$UEBER" ) 2>/dev/null; done; tail -1 $LOG/uebersprungen.txt)" "5311 b 1"
exit $fehler
