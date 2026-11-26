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
# freigabe-am-pr (25.11.): Die Freigabe-Prüfung am PR ist bis zum Approve rot (Es fehlt das KI-Urteil). Die Kette darf dadurch nicht halten (Deadlock), jede andere Ursache bleibt ein Halt. Die Stelle wird aus paket.sh gelesen, gh ist ein Ersatz.
PFL=$(grep -E '^pflicht_ausser_urteil\(\) \{' $S | sed 's/   # freigabe-am-pr.*//')
[ -n "$PFL" ] || { echo "ROT  pflicht_ausser_urteil nicht in paket.sh gefunden"; exit 1; }; eval "$PFL"
TAB=$(printf '\t')
gh() { case "$1 $2" in "pr checks") [ -n "${CHECKS-x}" ] && printf '%b' "$CHECKS" ;; "run view") echo x >> $T/rvn.count; [ "$(wc -l < $T/rvn.count)" -gt ${LEER_BIS:-0} ] && printf '%s' "$LOGTEXT" ;; "run rerun") echo "$3" >> $T/rerun.ids ;; esac; }
PASSALLE="CI${TAB}pass${TAB}1m${TAB}https://x/runs/1/job/2\nTestschutz${TAB}pass${TAB}1s${TAB}https://x/runs/3/job/4\n"
FREI_ROT="Freigabe-Prüfung${TAB}fail${TAB}5s${TAB}https://x/runs/77/job/8\n"
CHECKS="$PASSALLE$FREI_ROT"; LOGTEXT="Es fehlt das KI-Urteil: ein Approve von Antonio20045 oder jonas986 auf dem Stand abc1234."
pflicht_ausser_urteil 5; pruefe "nur das KI-Urteil fehlt: kein Halt" "$?" "0"
LOGTEXT="x.js: Prüfregel auf Branch paket/a. Es fehlt das KI-Urteil: ein Approve."
pflicht_ausser_urteil 5; pruefe "Prüfregel-Befund bleibt ein Halt" "$?" "1"
LOGTEXT="Code unter src/ kommt nur vom Bau-Agenten (x); Es fehlt das KI-Urteil: ein Approve."
pflicht_ausser_urteil 5; pruefe "src/ von anderem Autor bleibt ein Halt" "$?" "1"
CHECKS="${PASSALLE}Tests 1/3${TAB}fail${TAB}1m${TAB}https://x/runs/9/job/1\n$FREI_ROT"; LOGTEXT="Es fehlt das KI-Urteil: ein Approve."
pflicht_ausser_urteil 5; pruefe "andere rote Prüfung bleibt ein Halt" "$?" "1"
pruefe "andere rote Prüfung: PAU_GRUND nennt den Checknamen (rot, nicht pending)" "$PAU_GRUND" "ROT:Tests 1/3"
CHECKS="${PASSALLE}Tests 1/3${TAB}pending${TAB}0${TAB}https://x/runs/9/job/1\n$FREI_ROT"
pflicht_ausser_urteil 5; pruefe "andere offene Prüfung bleibt ein Halt" "$?" "1"
pruefe "andere offene (pending) Prüfung: PAU_GRUND ist PENDING, nicht ROT" "$PAU_GRUND" "PENDING"
CHECKS="${PASSALLE}Freigabe-Prüfung${TAB}pass${TAB}5s${TAB}https://x/runs/77/job/8\n"
pflicht_ausser_urteil 5; pruefe "alles grün: kein Halt" "$?" "0"
CHECKS=""; pflicht_ausser_urteil 5; pruefe "keine Auskunft von GitHub ist kein Freibrief" "$?" "1"
# A-WZN9ZN 26.11.: cwarten wertete gh pr checks' eigenen Exit-Code aus (1, sobald irgendein Check rot ist, auch die Freigabe-Prüfung, die erst durch das von PASS ausgelöste Approve grün wird, während andere Checks noch laufen) statt der Checks ohne die Freigabe-Prüfung zu bewerten (Halt "PR 6365: PASS, aber Checks weiter rot", Kette 6343, 26.11. 19:16). Die Stelle wird aus paket.sh gelesen, derselbe gh-Ersatz wie oben.
CWST=$(grep -oP 'O=\$\(gh pr checks \$1 -R sundartha/hermes 2>/dev/null\);.*?fi;' $S | head -1)
[ -n "$CWST" ] || { echo "ROT  cwarten-Stelle nicht in paket.sh gefunden"; exit 1; }
cw() { eval "$CWST"; echo $rc; }
CHECKS="${FREI_ROT}Tests 1/3${TAB}pending${TAB}0${TAB}https://x/runs/9/job/1\n"
pruefe "nur Freigabe-Prüfung rot, Rest wartet noch: cwarten wartet weiter" "$(cw 6365)" "8"
CHECKS="${FREI_ROT}Tests 1/3${TAB}pass${TAB}1m${TAB}https://x/runs/9/job/1\n"
pruefe "nur Freigabe-Prüfung rot, Rest ist fertig und grün: cwarten bleibt rot (Gesamtzustand wie gh)" "$(cw 6365)" "1"
CHECKS="${FREI_ROT}Tests 1/3${TAB}fail${TAB}1m${TAB}https://x/runs/9/job/1\n"
pruefe "ein anderer Check ist rot: cwarten bleibt rot" "$(cw 6365)" "1"
CHECKS="$PASSALLE"
pruefe "alles grün: cwarten ist grün" "$(cw 6365)" "0"
CHECKS=""
pruefe "keine Auskunft von GitHub: cwarten bleibt rot" "$(cw 6365)" "1"
unset -f cw
# A-K5M3CC 26.11.: Der Aufruf nach PASS lautet `cwarten $PR ... || umzug $PR $MIG || pflicht_ausser_urteil $PR || { halt }`; ist cwarten bei Freigabe rot/Rest grün nicht mehr grün (0), läuft die Kette weiter zu pflicht_ausser_urteil statt direkt zu freigeben.
CWFULL=$(grep -E '^cwarten\(\) \{' $S | sed 's/   # 17\.11\..*//')
[ -n "$CWFULL" ] || { echo "ROT  cwarten nicht in paket.sh gefunden"; exit 1; }
eval "$CWFULL"
phase() { :; }
CHECKS="${FREI_ROT}Tests 1/3${TAB}pass${TAB}1m${TAB}https://x/runs/9/job/1\n"
umzug() { return 1; }
PFLAUFGERUFEN=0
pflicht_ausser_urteil() { PFLAUFGERUFEN=1; return 0; }
cwarten 6365 > /dev/null 2>&1 || umzug 6365 MIGX || pflicht_ausser_urteil 6365
pruefe "Freigabe rot, Rest grün: Aufrufkette laeuft weiter zu pflicht_ausser_urteil" "$PFLAUFGERUFEN" "1"
unset -f phase umzug cwarten; eval "$PFL"
CHECKS=""; pflicht_ausser_urteil 5
pruefe "leere gh-Antwort: PAU_GRUND ist FEHLER, nicht ROT oder PENDING (A-TGA9A5-Nachbesserung 26.11.)" "$PAU_GRUND" "FEHLER"
# A-DXDZU8 26.11.: Ein abgelaufenes oder leeres Log ($G leer, z. B. nach Ablauf) gab bisher sofort "fail" zurück und hielt die Kette im Deadlock ("PASS, aber Checks weiter rot"), obwohl die Freigabe-Prüfung erst durch das von PASS ausgelöste Approve grün werden kann. Jetzt wird der Lauf einmal je Kopf (Lauf-ID) neu gestartet und auf ein lesbares Log gewartet, erst dann wie bisher entschieden.
PAKET_URTEIL_WARTE=0; LOG=$T/urteil; mkdir -p $LOG
rerunids() { tr '\n' ' ' < $T/rerun.ids 2>/dev/null; }
CHECKS="$PASSALLE$FREI_ROT"
rm -f $T/rvn.count $T/rerun.ids; LEER_BIS=1; LOGTEXT="Es fehlt das KI-Urteil: ein Approve."
pflicht_ausser_urteil 5; pruefe "leeres Log: einmal neu gestartet, danach wie gewohnt kein Halt" "$?|$(rerunids)" "0|77 "
rm -f $T/rvn.count $T/rerun.ids $LOG/neulog.txt; LEER_BIS=1; LOGTEXT="x.js: Prüfregel auf Branch paket/a. Es fehlt das KI-Urteil."
pflicht_ausser_urteil 5; pruefe "leeres Log, nach dem Neustart ein Prüfregel-Befund: Halt bleibt" "$?" "1"
rm -f $T/rvn.count $T/rerun.ids $LOG/neulog.txt; LEER_BIS=99; LOGTEXT="Es fehlt das KI-Urteil: ein Approve."
pflicht_ausser_urteil 5; pruefe "Log bleibt leer: Halt, kein Deadlock-Freibrief" "$?" "1"
rm -f $T/rvn.count $T/rerun.ids; LEER_BIS=99
pflicht_ausser_urteil 5; pruefe "derselbe Kopf wird nicht zweimal neu gestartet" "$?|$(rerunids)" "1|"
unset -f gh
pruefe "umzug (Prüfregel-PR) kommt vor der Ausnahme für das KI-Urteil" "$(grep -c 'cwarten \$PR > /dev/null 2>&1 || umzug \$PR \$MIG || pflicht_ausser_urteil \$PR ||' $S)" "1"
pruefe "freigeben wartet nach dem Approve auf die grüne Freigabe-Prüfung" "$(grep -E '^freigeben\(\)' $S | grep -c 'eingereiht \$1 || { urteil_gruen \$1;')" "1"
# A-TGA9A5 26.11.: Merge-Warten lief über 60 Runden (je Runde mehrere gh/API-Aufrufe plus sleep 60), damit länger als die zugesagten 60 Min. (6183, 6344, früher 5927 standen 1,5 h+); es gab keinen Halt dafür, dass der PR-Kopf kein Approve hat oder ein Pflicht-Check außer der Freigabe-Prüfung rot ist. Jetzt läuft die Frist per Wanduhr ($SECONDS) und etwa alle 5 Min. prüft eine reine Funktion (merge_entscheidung), ob gehalten, freigegeben, neu gestartet oder weitergewartet wird.
pruefe "Merge-Warten zählt keine Runden mehr (seq 1 60)" "$(grep -c 'for _ in \$(seq 1 60)' $S)" "0"
pruefe "Merge-Warten läuft per Wanduhr (SECONDS) mit der zugesagten 60-Minuten-Frist" "$(grep -c 'phase merge "PR \$PR" 3600; MWT=\$SECONDS; MWLETZT=\$SECONDS; while (( SECONDS - MWT < 3600 ))' $S)" "1"
pruefe "etwa alle 5 Min. (300 s), nicht jede Runde, wird der Kopf geprüft" "$(grep -c 'SECONDS - MWLETZT >= 300' $S)" "1"
MENT=$(sed -n '/^merge_entscheidung() {/,/^}$/p' $S); [ -n "$MENT" ] || { echo "ROT  merge_entscheidung nicht in paket.sh gefunden"; exit 1; }; eval "$MENT"
pruefe "Approve da, nichts rot: weiter warten" "$(merge_entscheidung 1 "" 0)" "WEITER"
pruefe "Approve da, nichts rot, PASS da: weiter warten (schon freigegeben, nicht nochmal)" "$(merge_entscheidung 1 "" 1)" "WEITER"
pruefe "kein Approve, kein PASS: Halt mit Grund" "$(merge_entscheidung 0 "" 0)" "HALT:kein Approve auf dem aktuellen Kopf"
pruefe "kein Approve, aber gültiges PASS: freigeben statt warten" "$(merge_entscheidung 0 "" 1)" "FREIGEBEN"
pruefe "Freigabe-Prüfung rot, kein Approve: Halt mit eigenem Grund" "$(merge_entscheidung 0 "ROT:Freigabe-Prüfung" 0)" "HALT:Pflicht-Check außer Freigabe-Prüfung rot"
pruefe "Freigabe-Prüfung rot, auch mit PASS aber ohne Approve: trotzdem Halt (nicht freigeben)" "$(merge_entscheidung 0 "ROT:Freigabe-Prüfung" 1)" "HALT:Pflicht-Check außer Freigabe-Prüfung rot"
pruefe "Freigabe-Prüfung rot, Approve vorhanden: rote_neu statt Halt" "$(merge_entscheidung 1 "ROT:Freigabe-Prüfung" 0)" "ROTE_NEU"
pruefe "Freigabe-Prüfung rot, Approve und PASS vorhanden: trotzdem rote_neu statt Halt" "$(merge_entscheidung 1 "ROT:Freigabe-Prüfung" 1)" "ROTE_NEU"
pruefe "CI rot, Approve vorhanden: wie Freigabe-Prüfung rote_neu statt Halt" "$(merge_entscheidung 1 "ROT:CI" 0)" "ROTE_NEU"
# Nachbesserung A-TGA9A5 26.11. (Prüferurteil FAIL zu PR 6388): ein echter anderer Pflicht-Check (nicht Freigabe-Prüfung/CI, nicht pending) bleibt auch mit Approve ein Halt, statt für immer rote_neu zu bleiben (Befund 2 des Urteils); pending zählt dabei nie als rot (Befund 3); eine leere/fehlgeschlagene gh-Antwort (FEHLER) löst in merge_entscheidung selbst nie einen eigenen Halt-Grund aus, das Zweimal-Messen dafür sitzt an der Aufrufstelle (Befund 1).
pruefe "echter anderer Pflicht-Check rot, Approve vorhanden: trotzdem Halt, nicht rote_neu" "$(merge_entscheidung 1 "ROT:Tests" 0)" "HALT:Pflicht-Check rot (Tests)"
pruefe "echter anderer Pflicht-Check rot, kein Approve: Halt nennt den Checknamen" "$(merge_entscheidung 0 "ROT:Tests" 0)" "HALT:Pflicht-Check rot (Tests)"
pruefe "pending (kein Approve): kein Halt wegen 'rot', nur der normale kein-Approve-Halt" "$(merge_entscheidung 0 "PENDING" 0)" "HALT:kein Approve auf dem aktuellen Kopf"
pruefe "pending, Approve vorhanden: weiter warten, kein Neustart, kein Halt" "$(merge_entscheidung 1 "PENDING" 0)" "WEITER"
pruefe "leere/fehlgeschlagene gh-Antwort (FEHLER), Approve vorhanden: weiter warten" "$(merge_entscheidung 1 "FEHLER" 0)" "WEITER"
pruefe "leere/fehlgeschlagene gh-Antwort (FEHLER), kein Approve, aber PASS: trotzdem freigeben" "$(merge_entscheidung 0 "FEHLER" 1)" "FREIGEBEN"
# Verhaltenstest der eingebauten 5-Minuten-Prüfung selbst (Mocks für approve, pflicht_ausser_urteil, pass_auf_kopf, rote_neu, freigeben): die Stelle wird aus paket.sh gelesen, nicht nachgebaut.
PRUEF=$(sed -n '/^    if \[ "\$S" = OPEN \] && (( SECONDS - MWLETZT >= 300 )); then/,/^    fi$/p' $S); [ -n "$PRUEF" ] || { echo "ROT  5-Minuten-Prüfstelle nicht in paket.sh gefunden"; exit 1; }
pruefstelle() {   # $1 Approve 1/0, $2 pflicht_ausser_urteil-Rückgabe (0 fein, 1 Befund), $3 PASS 1/0, $4 Sekunden seit letzter Prüfung, $5 PAU_GRUND bei Befund (ROT:<Name>, PENDING oder FEHLER), $6 Ordner für mehrere Messungen hintereinander (leer = neue, isolierte erste Messung mit frischem Zähler)
  local D=${6:-$(mktemp -d)} FA=$1 FR=$2 FP=$3 FG=$5; LOG=$D; PR=9; PRK=kopfabc; S=OPEN; MWLETZT=$(( SECONDS - $4 ))
  rm -f $D/halt.txt $D/aufrufe.txt
  MWHALT=""; MWHALTN=0; [ -f $D/zaehler.txt ] && { MWHALT=$(sed -n 1p $D/zaehler.txt); MWHALTN=$(sed -n 2p $D/zaehler.txt); }
  approve() { return $(( FA == 1 ? 0 : 1 )); }; pflicht_ausser_urteil() { PAU_GRUND=$FG; return $FR; }; pass_auf_kopf() { return $(( FP == 1 ? 0 : 1 )); }
  rote_neu() { echo "rote_neu $1" >> $D/aufrufe.txt; }; freigeben() { echo "freigeben $1" >> $D/aufrufe.txt; }
  ( eval "$PRUEF"; print -r -- "$MWHALT"$'\n'"$MWHALTN" > $D/zaehler.txt ) 2>/dev/null
  if [ -s $D/halt.txt ]; then echo "halt: $(cat $D/halt.txt)"; elif [ -s $D/aufrufe.txt ]; then cat $D/aufrufe.txt; else echo "weiter"; fi
}
pruefe "Frist (5 Min.) noch nicht erreicht: keine Prüfung, einfach weiter" "$(pruefstelle 0 1 0 60 "ROT:Tests")" "weiter"
pruefe "Frist erreicht, kein Approve, aber PASS: freigeben statt warten" "$(pruefstelle 0 0 1 300)" "freigeben 9"
pruefe "Frist erreicht, Approve da, Freigabe-Prüfung-Befund: rote_neu statt Halt" "$(pruefstelle 1 1 0 300 "ROT:Freigabe-Prüfung")" "rote_neu 9"
pruefe "Frist erreicht, Approve da, alles grün: einfach weiter" "$(pruefstelle 1 0 0 300)" "weiter"
pruefe "Frist erreicht, Approve da, nur pending: weiter, kein Neustart, kein Halt" "$(pruefstelle 1 1 0 300 PENDING)" "weiter"
# Befund 1 des Urteils zu PR 6388: eine einzelne leere/fehlgeschlagene gh-Antwort (FEHLER) darf nie allein halten, auch wenn kein Approve da ist und sie damit wie ein Halt-Kandidat aussieht.
D1=$(mktemp -d)
pruefe "eine einzelne leere gh-Antwort ohne Approve hält NICHT (erste Messung, Zähler 1)" "$(pruefstelle 0 1 0 300 FEHLER $D1)" "weiter"
pruefe "danach wieder alles in Ordnung: kein Halt, Zähler wurde nicht fälschlich fortgeschrieben" "$(pruefstelle 1 0 0 300 "" $D1)" "weiter"
# Befund 2+3: ein echter anderer Pflicht-Check (nicht pending, nicht Freigabe-Prüfung/CI) hält mit Approve erst nach der zweiten übereinstimmenden Messung, mit Grund, der den Checknamen oder "Pflicht-Check rot" nennt.
D2=$(mktemp -d)
pruefe "Approve da, echter anderer Pflicht-Check rot: erste Messung hält noch nicht" "$(pruefstelle 1 1 0 300 "ROT:Tests" $D2)" "weiter"
pruefe "Approve da, derselbe rote Check ein zweites Mal (5 Min. später): jetzt Halt mit Checknamen" "$(pruefstelle 1 1 0 300 "ROT:Tests" $D2)" "halt: PR 9: Pflicht-Check rot (Tests) (Kopf kopfabc)"
# pending darf nie als "rot" zählen, auch nicht ohne Approve; es bleibt höchstens der normale kein-Approve-Halt (nach zwei Messungen), nie ein Halt-Text mit "rot".
D3=$(mktemp -d)
pruefe "kein Approve, nur pending: erste Messung hält noch nicht" "$(pruefstelle 0 1 0 300 PENDING $D3)" "weiter"
pruefe "kein Approve, pending bleibt: zweite Messung hält wegen fehlendem Approve, nicht wegen 'rot'" "$(pruefstelle 0 1 0 300 PENDING $D3)" "halt: PR 9: kein Approve auf dem aktuellen Kopf (Kopf kopfabc)"

# A-FSY74P 26.11.: Einreihen über Antonios OAuth-Token (gh pr merge) scheitert ohne "workflow"-Scope, wenn der PR eine Workflow-Datei ändert (#6293, Kette 3776); bisher schluckte freigeben() den gh-Fehler stumm (> /dev/null 2>&1) und die Kette hielt erst indirekt über den "PASS übersprungen"-Zähler nach mehreren Neustarts. freigeben() erkennt den Fehlertext jetzt direkt und hält sofort mit eigenem Grund, über den vorhandenen Haltweg (kein starts.txt-Zähler betroffen).
FRG=$(grep -E '^freigeben\(\) \{' $S | head -1); [ -n "$FRG" ] || { echo "ROT  freigeben nicht in paket.sh gefunden"; exit 1; }
freigeben_lauf() {   # $1 PR-Nummer, $2 Fehlertext der zweiten "antonio pr merge"-Stelle (leer = die Stelle meldet Erfolg)
  LOG=$(mktemp -d); FEHLERTEXT=$2
  approve() { return 0; }; eingereiht() { return 1; }; urteil_gruen() { :; }; pass_am_pr() { :; }
  antonio() { case "$*" in *--disable-auto*) return 0 ;; *) [ -n "$FEHLERTEXT" ] && echo "$FEHLERTEXT" >&2; return 1 ;; esac; }
  ( eval "$FRG"; freigeben "$1" ) 2>/dev/null
  [ -s $LOG/halt.txt ] && cat $LOG/halt.txt || echo "(kein Halt)"
}
pruefe "Fehlertext nennt die fehlende workflow-Berechtigung: Halt nennt Grund und PR-Nummer" \
  "$(freigeben_lauf 6293 'GraphQL: refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope')" \
  "Einreihen braucht workflow-Berechtigung: Antonio klickt Merge when ready (PR 6293) oder gh auth refresh -s workflow"
pruefe "anderer gh-Fehler (keine workflow-Berechtigung betroffen): bisheriges Verhalten bleibt (Halt 'Freigabe nicht ausgeführt')" \
  "$(freigeben_lauf 6293 'HTTP 502: Bad Gateway')" \
  "Freigabe nicht ausgeführt (PR 6293)"

# Kette #6183/PR 6402, 26.11.: WARTET=<PR> auf einem offenen eigenen Zweig (paket/<ISSUE>-*) lief nie an, weil kein Prüfer draufwartete. Ist WA selbst ein solcher PR, läuft die Kette wie bei einem gemeldeten PR=<WA> weiter statt zu halten.
STELLE_WARTET=$(grep -oE 'WA=\$\(grep -oE .WARTET=\[0-9\]\+. \$LOG/bau-\$N\.log \| tail -1 \| cut -d= -f2\); if .*fi; fi' $S | head -1)
[ -n "$STELLE_WARTET" ] || { echo "ROT  WARTET-Stelle nicht in paket.sh gefunden"; exit 1; }
wa() { local D=$(mktemp -d); LOG=$D; N=1; ISSUE=6183; echo "$2" > $LOG/bau-1.log; ERGEBNIS=$1; local MOCK=$3; gh() { echo "$MOCK"; }
  ( eval "$STELLE_WARTET" 2>/dev/null; echo "ERGEBNIS=$ERGEBNIS" > $LOG/erg.txt ) 2>/dev/null
  echo "$(cat $LOG/erg.txt 2>/dev/null)|WA_FILE=$(cat $LOG/wartet-auf.txt 2>/dev/null)|HALT=$(cat $LOG/halt.txt 2>/dev/null)"; }
pruefe "WA ist offener PR auf eigenem Zweig: laeuft als PR weiter statt zu halten" "$(wa keiner "WARTET=6402" "paket/6183-foo")" "ERGEBNIS=6402|WA_FILE=|HALT="
pruefe "WA ist kein offener eigener Zweig (Issue, Vorgaenger, fremder PR): haelt wie bisher" "$(wa keiner "WARTET=6402" "")" "|WA_FILE=6402|HALT=wartet auf PR 6402 (Neustart danach von selbst, sobald #6402 geschlossen ist)"
pruefe "ist der Bau schon mit PR=<nummer> fertig, greift die WARTET-Pruefung gar nicht" "$(wa 5555 "PR=5555" "paket/6183-foo")" "ERGEBNIS=5555|WA_FILE=|HALT="
exit $fehler
