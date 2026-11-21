#!/bin/zsh
# Aufruf: nohup reihe.sh <issue> <issue> … &  – startet die Pakete der Reihe nach, höchstens 2 paket.sh gleichzeitig.
set -u
HIER=/Users/antonio/Bereiche/sundartha/engineering
KETTEN=${KETTEN:-$HIER/ketten}   # Zustandsordner der Ketten (wie in paket.sh)
for ISSUE in "$@"; do
  while [ "$(pgrep -f 'paket.sh [0-9]' | wc -l | tr -d ' ')" -ge 2 ]; do sleep 120; done
  [ -f $KETTEN/paket-$ISSUE/fertig.txt ] && continue
  pgrep -f "paket.sh $ISSUE\$" >/dev/null && continue
  [ -f $KETTEN/paket-$ISSUE/halt.txt ] && mv $KETTEN/paket-$ISSUE/halt.txt $KETTEN/paket-$ISSUE/halt-$(date +%H%M).txt
  echo "$(date -u +%FT%TZ) starte $ISSUE" >> $HIER/reihe.log
  nohup $HIER/paket.sh $ISSUE > $KETTEN/paket-$ISSUE.nohup 2>&1 &
  sleep 60
done
echo "$(date -u +%FT%TZ) Reihe leer" >> $HIER/reihe.log
