#!/bin/bash
# Verhaltenstest zu anspruch.sh (#4438): zwei Läufe desselben Mitarbeiters bauen nie dasselbe Paket. Lokales Bare-Repo als Remote hermes, falsches gh vorn im PATH.
S=${1:-$(cd "$(dirname "$0")" && pwd)/anspruch.sh}
T=$(mktemp -d); fehler=0; N=4438
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
mkdir -p $T/bin
printf '%s\n' '#!/bin/bash' '[ -z "$GH_KAPUTT" ] || exit 1' '[ "$1 $2" = "pr list" ] && [[ "$*" == *"-R sundartha/hermes"* ]] || exit 1' '[[ "$*" == *"--state open"* ]] && exec cat "$PRS"' '[[ "$*" == *"--state all --head "* ]] || exit 1' 'while [ "$1" != "--head" ]; do shift; done; grep -c -x -- "$2" "$ERLEDIGT"; true' > $T/bin/gh
chmod +x $T/bin/gh; export PATH=$T/bin:$PATH PRS=$T/prs.json ERLEDIGT=$T/erledigt.txt
pruefe() { [[ "$2" == "$3" ]] && echo "ok   $1" || { echo "ROT  $1: '$2' != '$3'"; fehler=1; }; }
neu() {
  rm -rf $T/remote.git $T/w; git init -q --bare -b master $T/remote.git
  git clone -q $T/remote.git $T/w 2>/dev/null; git -C $T/w commit -q --allow-empty -m a; git -C $T/w push -q origin HEAD:master
  echo '[]' > $PRS; : > $ERLEDIGT
}
alt() { local d; d=$(date -u -d "$1 minutes ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-"$1"M +%Y-%m-%dT%H:%M:%SZ); echo $d; }
zweig() { GIT_AUTHOR_DATE=$(alt $2) GIT_COMMITTER_DATE=$(alt $2) git -C $T/w commit -q --allow-empty -m "${3:-$1}"; git -C $T/w push -q origin HEAD:refs/heads/$1 --force; git -C $T/w reset -q --hard HEAD~1; }
anspruch() { zweig paket/$1-anspruch $3 "Anspruch #$1 von $2 $(alt $3)"; }
pr() { printf '[{"number":%s,"headRefName":"%s","body":"%s"}]\n' "$1" "$2" "$3" > $PRS; }
EIGEN=paket/$N-eigen
fall() { local was=$1 soll=$2 hinweis=${3:-}; local D; D=$(mktemp -d -p $T); git clone -q $T/remote.git $D 2>/dev/null; git -C $D remote rename origin hermes
  ( cd $D && bash "$S" $N $EIGEN 2> $D.err ); local rc=$?; pruefe "$was" "$rc" "$soll"
  [ -z "$hinweis" ] || pruefe "$was: stderr nennt $hinweis" "$(grep -c -- "$hinweis" $D.err)" "1"; }

[ -f "$S" ] || { echo "ROT  anspruch.sh fehlt"; exit 1; }

neu; D1=$(mktemp -d -p $T); D2=$(mktemp -d -p $T); git clone -q $T/remote.git $D1 2>/dev/null; git clone -q $T/remote.git $D2 2>/dev/null
git -C $D1 remote rename origin hermes; git -C $D2 remote rename origin hermes
( cd $D1 && bash "$S" $N paket/$N-a 2>/dev/null; echo $? > $T/rc1 ) & ( cd $D2 && bash "$S" $N paket/$N-b 2>/dev/null; echo $? > $T/rc2 ) & wait
pruefe "K1 zwei gleichzeitige Aufrufe: genau einer baut" "$(cat $T/rc1 $T/rc2 | sort | tr '\n' ' ')" "0 1 "
neu; fall "K1 erster Aufruf ohne Anspruch baut" 0
pruefe "K1 Anspruch nennt den Halter" "$(git -C $T/remote.git log -1 --format=%s refs/heads/paket/$N-anspruch | cut -d' ' -f1-3)" "Anspruch #$N von"

neu; anspruch $N paket/$N-andere 10; fall "K2 junger fremder Anspruch" 1 "paket/$N-andere"
neu; anspruch $N paket/$N-andere 239; fall "K2 Anspruch kurz vor der Höchstdauer" 1
neu; anspruch $N paket/$N-andere 241; fall "K2 verfallener Anspruch wird übernommen" 0
pruefe "K2 Anspruch nennt danach den eigenen Zweig" "$(git -C $T/remote.git log -1 --format=%s refs/heads/paket/$N-anspruch | cut -d" " -f4)" "$EIGEN"
neu; anspruch $N $EIGEN 10; fall "K3 eigener Anspruch" 0
neu; anspruch $N $EIGEN 500; fall "K3 eigener verfallener Anspruch" 0

neu; pr 77 "paket/$N-fremd" "x"; fall "K4 offener PR mit Kopf paket/$N-*" 1 "#77"
neu; pr 78 "system/$N-fremd" "x"; fall "K4 offener PR mit Kopf system/$N-*" 1 "#78"
neu; pr 79 "andere/x" "Refs #$N"; fall "K4 Text Refs" 1 "#79"
neu; pr 80 "andere/x" "Das Ergebnis. Closes #$N."; fall "K4 Text Closes" 1 "#80"
neu; pr 81 "andere/x" "Teil von #$N"; fall "K4 Text Teil von" 1 "#81"
neu; pr 82 "$EIGEN" "Refs #$N"; fall "K4 PR mit eigenem Kopf" 0
neu; pr 83 "andere/x" "Refs #$N0"; fall "K5 Text mit längerer Nummer" 0
neu; pr 84 "paket/${N}0-x" "Closes #${N}0"; fall "K5 PR zu Issue ${N}0" 0
neu; pr 85 "paket/443-x" "Closes #443"; fall "K5 PR zu Issue 443" 0
neu; anspruch ${N}0 paket/${N}0-x 5; anspruch 443 paket/443-x 5; fall "K5 Anspruch zu anderem Issue" 0

neu; zweig paket/$N-alt 10; fall "K6 junger fremder Zweig ohne Anspruch" 1 "paket/$N-alt"
neu; zweig system/$N-alt 10; fall "K6 junger fremder system-Zweig" 1 "system/$N-alt"
neu; zweig paket/$N-alt 241; fall "K6 alter fremder Zweig" 0
neu; zweig $EIGEN 10; fall "K6 eigener Zweig" 0
neu; zweig system/$N-eigen 10; fall "K6 eigener Zweig unter system" 0
neu; zweig paket/${N}0-alt 10; fall "K6 Zweig zu Issue ${N}0" 0
neu; anspruch $N paket/$N-erstes 10; echo paket/$N-erstes > $ERLEDIGT; fall "K7 Folgehäppchen nach Merge des Vorgängers baut" 0
pruefe "K7 Anspruch nennt danach den eigenen Zweig" "$(git -C $T/remote.git log -1 --format=%s refs/heads/paket/$N-anspruch | cut -d" " -f4)" "$EIGEN"
neu; anspruch $N paket/$N-erstes 10; zweig paket/$N-erstes 10; echo paket/$N-erstes > $ERLEDIGT; fall "K7 Zweig des gemergten Vorgängers bleibt stehen" 0
neu; anspruch $N paket/$N-andere 10; echo paket/$N-erstes > $ERLEDIGT; fall "K7 Halter ohne PR bleibt besetzt" 1 "paket/$N-andere"
neu; anspruch $N paket/$N-andere 10; GH_KAPUTT=1 fall "K8 scheiterndes gh" 2
echo "fehler=$fehler"
exit $fehler
