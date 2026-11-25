#!/bin/zsh
# Verhaltenstest zu paket.sh (A-55NDA7): (1) abgelaufene Parkzeit startet die Kette einmal selbst (Eintrag in die Warteschlange, Sperre wird umbenannt = Marker), Fünf-Starts-Bremse, Mensch-Frage und Mac-Ketten bleiben ausgenommen; (2) freigegebener, grüner PR ohne Queue-Platz wird eingereiht, sonst nie. Die Stellen werden aus paket.sh gelesen; ein falsches gh/antonio ersetzt GitHub.
S=${1:-${0:A:h}/paket.sh}
T=$(mktemp -d); fehler=0
pruefe() { [[ "$2" == "$3" ]] && echo "ok   $1" || { echo "ROT  $1: '$2' != '$3'"; fehler=1; }; }
stelle() { sed -n "/^$1() {/,/^}/p" $S; }
PV=$(stelle park_vorbei); EF=$(stelle einreihen_freigegebene)
[ -n "$PV" ] && [ -n "$EF" ] || { echo "ROT  Stellen nicht in paket.sh gefunden"; exit 1; }
eval "$PV"; eval "$EF"
# (1) Parkzeit
KETTEN=$T/k; mkdir -p $KETTEN; ISSUE=1; ZAEHLER=0
heute=$(TZ=Europe/Berlin date +%F); gestern=$(TZ=Europe/Berlin date -d yesterday +%F 2>/dev/null || TZ=Europe/Berlin date -v-1d +%F); morgen=$(TZ=Europe/Berlin date -d tomorrow +%F 2>/dev/null || TZ=Europe/Berlin date -v+1d +%F)
kette() { local D=$KETTEN/paket-$1; mkdir -p $D; [ -z "$2" ] || echo "$2" > $D/halt-bis.txt; echo $D; }
fall() { local D=$(kette $(basename $(mktemp -d -p $T)) "$1"); [ -z "$2" ] || eval "$2"; park_vorbei $D && echo start || echo bleibt; }
pruefe "Parkzeit gestern: startet" "$(fall "$gestern Konflikt")" start
pruefe "Parkzeit heute: startet" "$(fall "$heute Konflikt")" start
pruefe "Parkzeit morgen: bleibt" "$(fall "$morgen Konflikt")" bleibt
pruefe "Parkzeit ohne Datum: bleibt" "$(fall "bis auf Weiteres")" bleibt
pruefe "Parkzeit nennt Antonio: bleibt" "$(fall "$gestern Antonio entscheidet")" bleibt
pruefe "Parkzeit mit MENSCH-Frage: bleibt" "$(fall "$gestern MENSCH: Frage")" bleibt
pruefe "Kette auf dem Mac (auf-mac.txt): bleibt" "$(fall "$gestern x" 'touch $D/auf-mac.txt')" bleibt
pruefe "Halt-Grund mensch: bleibt" "$(fall "$gestern x" 'echo mensch > $D/halt-grund.txt')" bleibt
pruefe "fuenf Starts am selben Haeppchen: bleibt (Bremse)" "$(fall "$gestern x" 'printf "3\n3\n3\n3\n3\n" > $D/starts.txt')" bleibt
pruefe "vier Starts: startet" "$(fall "$gestern x" 'printf "3\n3\n3\n3\n4\n" > $D/starts.txt')" start
# die Stelle in ende(): umbenennen, einreihen, danach kein zweiter Eintrag
BL=$(grep -A1 'halt-bis.txt(N); do' $S)
[ -n "$BL" ] || { echo "ROT  Parkstelle in ende() nicht gefunden"; exit 1; }
lauf() { local F I; eval "$BL"; }
D=$(kette 30 "$gestern Konflikt"); echo "2 x" > $D/konto.txt; : > $KETTEN/paket-warteschlange.txt; lauf
pruefe "Parkstelle reiht die Kette mit ihrem Konto ein" "$(cut -d' ' -f1-2 $KETTEN/paket-warteschlange.txt)" "30 2"
pruefe "Sperre ist umbenannt, nicht geloescht" "$(ls $D | grep -c '^halt-bis-abgelaufen-')$([ -e $D/halt-bis.txt ] && echo da)" "1"
lauf; pruefe "zweiter Lauf: kein zweiter Eintrag (einmal)" "$(wc -l < $KETTEN/paket-warteschlange.txt | tr -d ' ')" "1"
D=$(kette 1 "$gestern eigene Kette"); : > $KETTEN/paket-warteschlange.txt; lauf
pruefe "eigene Kette wird nicht eingereiht" "$(wc -l < $KETTEN/paket-warteschlange.txt | tr -d ' ')" "0"
# (2) Einreihen
LISTE="5 aaaaaaaa"; GRUEN=1; FREI=1; DRIN=0; : > $KETTEN/nachgetragen.txt; AUFRUFE=$T/aufrufe
gh() { [ "$1 $2" = "pr list" ] || return 1; [ "$GRUEN" = 1 ] && echo "$LISTE"; return 0; }   # nur grüne PR (mergeStateStatus CLEAN) erscheinen in der Liste
approve() { [ "$FREI" = 1 ]; }; eingereiht() { [ "$DRIN" = 1 ]; }; antonio() { echo "$*" >> $AUFRUFE; }
neu() { : > $AUFRUFE; : > $KETTEN/einreihen.txt; }
neu; einreihen_freigegebene; pruefe "freigegeben und gruen: wird eingereiht" "$(cat $AUFRUFE)" "pr merge 5 -R sundartha/hermes --rebase --auto"
einreihen_freigegebene; pruefe "derselbe Kopf: kein zweites Mal" "$(wc -l < $AUFRUFE | tr -d ' ')" "1"
neu; FREI=0; einreihen_freigegebene; pruefe "ohne Approve: nichts" "$(wc -l < $AUFRUFE | tr -d ' ')" "0"; FREI=1
neu; GRUEN=0; einreihen_freigegebene; pruefe "nicht gruen: nichts" "$(wc -l < $AUFRUFE | tr -d ' ')" "0"; GRUEN=1
neu; DRIN=1; einreihen_freigegebene; pruefe "schon in der Queue: nichts" "$(wc -l < $AUFRUFE | tr -d ' ')" "0"; DRIN=0
# Auswahl der Liste (aus paket.sh gelesen): CLEAN, kein Entwurf, Zweig paket/ oder system/
pruefe "Liste verlangt CLEAN, kein Entwurf, paket/system" "$(grep -c 'mergeStateStatus == "CLEAN") and (.headRefName | test("^(paket|system)/"))' $S)" "1"
[ $fehler = 0 ] && echo "ALLES GRUEN" || exit 1
