#!/bin/zsh
# Startet Ketten neu, die nur wegen gesperrtem Board ("keine Karte") nicht starten. Höchstens 3 h, jede Minute ein Versuch.
cd /Users/antonio/Bereiche/sundartha/engineering
for i in $(seq 1 180); do
  for p in 4847:$(tail -1 ketten/paket-4847/konto.txt 2>/dev/null | awk "{print \$1}") 4884:3; do
    n=${p%%:*}; k=${p##*:}
    if tail -1 ketten/paket-$n/kette.out 2>/dev/null | grep -q "keine Karte" && ! pgrep -f "paket.sh $n " >/dev/null; then
      nohup ./paket.sh $n $k >> ketten/paket-$n/kette.out 2>&1 &
      sleep 20
    fi
  done
  sleep 60
done
