#!/bin/zsh
# Verhaltenstest zu paket.sh (Rücklauf-Stelle): Liegt der PR eines Häppchens auf system/<name>, findet die Kette den Worktree paket-<name> (Branch paket/<name>) wie bei paket/<name>. Die Stelle wird aus paket.sh selbst gelesen, nicht nachgebaut.
S=${1:-${0:A:h}/paket.sh}
T=$(mktemp -d); fehler=0
gitr() { git -C "$REPO" "$@"; }   # paket.sh ruft git im Ordner REPO über gitr auf (Sperre, Issue 5760); der Test nutzt es ohne Sperre

REPO=$T/repo; mkdir -p $REPO && git -C $REPO init -q -b master && git -C $REPO commit -q --allow-empty -m a
git -C $REPO worktree add -q $T/wt-x1 -b paket/x1 >/dev/null
STELLE=$(grep -E '^kopie_von\(\) \{' $S | head -1)   # 24.11.: eine Funktion für Rücklauf und Wegräumen
[ -n "$STELLE" ] || { echo "ROT  Stelle nicht in paket.sh gefunden"; exit 1; }
eval "$STELLE"; suche() { kopie_von "$1"; }
pruefe() { [[ "$2" == "$3" ]] && echo "ok   $1" || { echo "ROT  $1: '$2' != '$3'"; fehler=1; }; }
W=$(cd $T/wt-x1 && pwd -P)
pruefe "PR auf paket/x1 findet den Worktree" "$(suche paket/x1)" "$W"
pruefe "PR auf system/x1 findet denselben Worktree" "$(suche system/x1)" "$W"
WEG=$(grep -E '^wegraeumen\(\) \{' $S | head -1); [ -n "$WEG" ] || { echo "ROT  wegraeumen nicht in paket.sh gefunden"; exit 1; }; eval "$WEG"   # 24.11.: die Kette räumt die Arbeitskopie eines gemergten/geschlossenen PR selbst weg
git -C $REPO worktree add -q $T/wt-y -b paket/y >/dev/null; gh() { echo paket/y; }; wegraeumen 1; unset -f gh
pruefe "wegraeumen entfernt Arbeitskopie und Zweig des PR" "$(ls $T | grep -c "^wt-y$")$(git -C $REPO branch --list paket/y | wc -l | tr -d ' ')" "00"
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
# CI-ROT-1119: PASS auf unverändertem Kopf wird nur bei grüner CI übersprungen; bei roter CI geht die Kette in die Rücklauf-Schleife statt zu überspringen (2973, 5006).
pruefe "Skip-Bedingung prueft die CI" "$(grep -c 'pass_auf_kopf \$PR \$PRK && { case "$(ci_lage \$PR)" in gruen) ;; \*) CIROT=1' $S)" "1"
pruefe "Schleife betritt PASS-PR bei roter CI" "$(grep -c '\[ "\$PRM" = CONFLICTING \] || \[ -n "\$CIROT" \]; do' $S)" "1"
pruefe "rote CI startet keinen neuen Bau" "$(grep -c 'elif \[ -n "\$CIROT" \]; then :' $S)" "1"
# 5473: pcmd mit fehlender PID (Elternprozess schon weg) bricht unter set -u nicht ab und liefert leer; mit PID weiter die Befehlszeile.
PCMD=$(grep -o '^pcmd() {[^#]*' $S | head -1)
[ -n "$PCMD" ] || { echo "ROT  pcmd nicht in paket.sh gefunden"; exit 1; }
pruefe "pcmd ohne PID bricht nicht ab" "$(STELLE=$PCMD zsh -c 'set -u; eval "$STELLE"; pcmd; pcmd ""; echo ok' 2>&1)" "ok"
pruefe "pcmd mit PID liefert die Befehlszeile" "$(STELLE=$PCMD zsh -c 'set -u; eval "$STELLE"; [ -n "$(pcmd $$)" ] && echo ja' 2>&1)" "ja"
# A-VA2YWR 19.11. (5137, 5491): Halt-Grund der Nachbesserung ehrlich. Kopf seit dem letzten Nachtrag unverändert = nicht umgesetzt; dreimal umgesetzt = Grenze; sonst weiter. Die Stelle wird aus paket.sh gelesen.
NBST=$(grep -A2 -m1 'KN=\$(kopf \$PR); KL=' $S)
[ -n "$NBST" ] || { echo "ROT  Nachbesserungs-Stelle nicht in paket.sh gefunden"; exit 1; }
nb() { local D=$(mktemp -d); LOG=$D; PR=9; N=1; R=1; : > $LOG/bau-1-bewerten-1.log; kopf() { echo "$KOPFNEU"; }; [ -n "$1" ] && printf "$1" > $LOG/nachbessern.txt; [ -n "$2" ] && echo "9 $2" > $LOG/nachbessern-kopf.txt; KOPFNEU=$3; eval "$NBST"; echo "$HG" | cut -c1-30; }
pruefe "erster Nachtrag: weiter" "$(nb '' '' aaa)" ""
pruefe "Kopf unveraendert seit Nachtrag: nicht umgesetzt" "$(nb '9\n' aaa aaa)" "Bau hat den letzten Plan-Nacht"
pruefe "dreimal umgesetzt: Grenze" "$(nb '9\n9\n9\n' aaa bbb)" "Nachbesserungsgrenze erreicht "
pruefe "zweimal umgesetzt: weiter" "$(nb '9\n9\n' aaa bbb)" ""
pruefe "Halt-Kommentar mit letzter Bewertung steht im Issue" "$(grep -c 'Paket hält bei PR #\$PR: \$HG. Letzte Bewertung' $S)" "1"
# A-5UNP4V 25.11.: Startgrenze zählt nur, wenn starts.txt frisch ist (PAKET_STARTS_FRIST, 360 min); ein alter Zähler (5x) lässt den Start zu, ein frischer hält. Die Stelle wird aus paket.sh gelesen.
GRENZE=$(grep -m1 'sechster Start ohne Merge' $S | sed 's/   # zählt nur.*//')
[ -n "$GRENZE" ] || { echo "ROT  Startgrenze nicht in paket.sh gefunden"; exit 1; }
grenze() { local D=$(mktemp -d); LOG=$D; START=h1; ( for _ in 1 2 3 4 5; do echo h1; done ) > $LOG/starts.txt; [ -n "$1" ] && touch -t $(date -d "$1 hours ago" +%Y%m%d%H%M 2>/dev/null || date -v-${1}H +%Y%m%d%H%M) $LOG/starts.txt; ( eval "$GRENZE" ) 2>/dev/null; [ -s $LOG/halt.txt ] && echo halt || echo frei; }
pruefe "frischer Zaehler (5 Starts) haelt" "$(grenze)" "halt"
pruefe "7 h alter Zaehler (5 Starts) startet" "$(grenze 7)" "frei"
# wt-steuerung (Issue 5760): alle Git-Aufrufe im gemeinsamen Ordner laufen unter einer Sperre; ein index.lock-Zusammenstoß wird wiederholt statt zu scheitern
GITR=$(grep -E '^gitr\(\) \{' $S | sed 's/   # 21\.11\..*//')
[ -n "$GITR" ] || { echo "ROT  gitr in paket.sh nicht gefunden"; exit 1; }
pruefe "paket.sh ruft git im Ordner REPO nur noch ueber gitr auf" "$(grep -v '^gitr()' $S | grep -c 'git -C "\$REPO"')" "0"
G=$T/gr; mkdir -p $G && git -C $G init -q -b master && git -C $G commit -q --allow-empty -m a
KETTEN=$T/k; mkdir -p $KETTEN; REPO=$G; eval "$GITR"
touch $G/.git/index.lock; ( sleep 3; mv $G/.git/index.lock $T/lock.weg ) &
gitr checkout -q --detach master; pruefe "index.lock-Zusammenstoss wird wiederholt und gelingt" "$?" "0"; wait
( gitr checkout -q --detach master & gitr checkout -q --detach master & gitr checkout -q --detach master & wait ) 2>/dev/null
pruefe "drei gleichzeitige Checkouts unter der Sperre" "$(git -C $G rev-parse --abbrev-ref HEAD)" "HEAD"
GL=$(grep -E '^gitr\(\) \{' $S | sed 's/   # 21\.11\..*//')
pruefe "gitr nimmt unter Linux flock und unter Darwin lockf" "$(print -r -- "$GL" | grep -c 'flock -w 120.*lockf -k -t 120\|lockf -k -t 120.*flock -w 120')" "1"
pruefe "ausgeloest sucht den CI-Lauf ueber die Workflow-Datei, nicht ueber den Laufnamen" "$(grep -E '^ausgeloest\(\)' $S | grep -c 'index(".github/workflows/ci.yml")')" "1"
pruefe "ausgeloest liest nicht mehr den Laufnamen CI" "$(grep -E '^ausgeloest\(\)' $S | grep -c 'index("CI")')" "0"
# Anspruch (#4438): die Kette erkennt offene PRs des Issues an Kopf und Text und gibt WARTET=<PR> aus, wenn bau "ist in Arbeit" meldet.
pruefe "Bau-Prompt erkennt offene PRs an Kopf paket/ISSUE-* und system/ISSUE-*" "$(grep -c 'offenen PR zum Issue (Kopf paket/\$ISSUE-\* oder system/\$ISSUE-\*, oder im Text .Refs #\$ISSUE., .Closes #\$ISSUE. oder .Teil von #\$ISSUE.): übernimm ihn' $S)" "1"
pruefe "Kette wartet auf die PR-Nummer aus ist in Arbeit" "$(grep -c "Antwortet bau mit 'ist in Arbeit' und nennt eine PR-Nummer, schreib davor eine eigene Zeile WARTET=<diese Nummer> und als letzte Zeile PR=keiner" $S)" "1"
pruefe "Entscheidungs-Sitzung sucht offene PRs des Issues an Kopf und Text" "$(grep -c "falls es einen offenen PR zum Issue gibt (Kopf paket/\$ISSUE-\* oder system/\$ISSUE-\*" $S)" "1"
exit $fehler
